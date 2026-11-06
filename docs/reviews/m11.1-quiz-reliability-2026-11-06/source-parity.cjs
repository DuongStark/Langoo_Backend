// Read-only production parity/performance check. Never prints user IDs or source text.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const app = '/opt/langoo/app';
const req = Module.createRequire(app + '/package.json');
const { ConfigService } = req('@nestjs/config');
const env = req('dotenv').parse(fs.readFileSync(app + '/.env'));
const { PrismaService } = req(app + '/dist/db/prisma.service');
const file = app + '/dist/ai/quiz/repositories/quiz-source.repository.js';
const Old = req(file).QuizSourceRepository;
const replacement = new Module(file);
replacement.filename = file;
replacement.paths = Module._nodeModulePaths(path.dirname(file));
replacement._compile(fs.readFileSync(process.argv[2], 'utf8'), file);
const New = replacement.exports.QuizSourceRepository;
(async () => {
  const db = new PrismaService(new ConfigService(env));
  await db.$connect();
  try {
    const result = await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout='10s'");
      const profiles = await tx.$queryRawUnsafe(`SELECT p.id,p.user_id,count(i.id)::int AS count
        FROM app.study_profile p JOIN public.language l ON l.id=p.primary_language_id
        JOIN app.collection c ON c.profile_id=p.id AND c.owner_id=p.user_id
        JOIN app.collection_item i ON i.collection_id=c.id
        WHERE l.code='ja' AND c.archived_at IS NULL AND i.status <> 'paused'
        GROUP BY p.id,p.user_id ORDER BY count(i.id) DESC LIMIT 3`);
      const result = [];
      for (const profile of profiles) {
        let before;
        const row = { source_count: profile.count, runs: [] };
        for (const [version, Repository] of [['before',Old],['after',New]]) {
          const queryMs = [];
          const client = new Proxy(tx, { get(target, key) {
            if(key === '$queryRaw') return async (...args) => {
              const start = Date.now();
              try { return await target.$queryRaw(...args); }
              finally { queryMs.push(Date.now() - start); }
            };
            return target[key];
          }});
          const start = Date.now();
          const items = await new Repository(db).findSourceItems({userId:profile.user_id,profileId:profile.id,collectionId:null,enrichKanji:true,withExamples:true},client);
          if(before) assert.deepEqual(items,before);
          else before=items;
          row.runs.push({version,eligible:items.length,elapsed_ms:Date.now()-start,query_ms:queryMs});
        }
        row.output_identical=true;
        result.push(row);
      }
      assert.equal(result.length,3);
      return result;
    }, {timeout:90_000,maxWait:10_000});
    console.log(JSON.stringify({code:'M11.1',read_only:true,order:'before then after; cache can influence timings',results:result}));
  } finally { await db.$disconnect(); }
})().catch(e=>{ console.error(JSON.stringify({code:e.code ?? 'CHECK_FAILED',name:e.name}));process.exitCode=1; });

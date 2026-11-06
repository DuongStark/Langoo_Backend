// Real quiz providers; synthetic words only. No API users, DB or production config writes.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const repo = '/opt/langoo/app';
const cfg = require(path.join(repo, 'node_modules/dotenv')).parse(fs.readFileSync(path.join(repo, '.env')));
const { ConfigService } = require(path.join(repo, 'node_modules/@nestjs/config'));
const { createAiQuizProvider } = require(path.join(repo, 'dist/ai/providers/ai-quiz-provider.factory.js'));
const { buildQuizQuestions } = require(path.join(repo, 'dist/ai/quiz/quiz-generator.js'));
const root = process.argv[2];
assert(root.startsWith('/tmp/langoo-m111-quiz-') && fs.existsSync(root + '/OWNED_BY_M111'));
const key = cfg.AI_API_KEY;
assert(cfg.AI_BASE_URL === 'https://api-cdn.deploy.com/api/v1');
const words = [['学校','がっこう','trường học','school'],['銀行','ぎんこう','ngân hàng','bank'],['電話','でんわ','điện thoại','telephone'],['新聞','しんぶん','báo','newspaper'],['図書館','としょかん','thư viện','library'],['病院','びょういん','bệnh viện','hospital'],['会社','かいしゃ','công ty','company'],['電車','でんしゃ','tàu điện','train'],['自転車','じてんしゃ','xe đạp','bicycle'],['公園','こうえん','công viên','park'],['映画','えいが','phim','movie'],['料理','りょうり','nấu ăn','cooking']];
function input() {
  let seed = 123456789;
  const rng = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  return { questionCount: 10, questionTypes: ['multiple_choice'], languageId: 22, rng: { next: rng },
    usage: { tokensIn: 0, tokensOut: 0, calls: 0, local: 0, reused: 0 },
    beforeExternalCall: () => Promise.resolve(),
    items: words.map(([written, reading, vi, en], i) => ({ itemId: '00000000-0000-4000-8000-' + String(i+1).padStart(12,'0'), senseId: String(i+1), conceptId: null, languageId: 22, languageCode: 'ja', lemma: written, reading, romanization: null, pos: 'noun', meaningVi: vi, glossEn: [en], glossViMachine: false, kanjiPairs: [{ written, reading, eligible: true }], examples: [] })) };
}
const nativeFetch = global.fetch;
const calls = [];
global.fetch = async (url, options) => {
  const request = JSON.parse(options.body);
  const start = Date.now();
  const response = await nativeFetch(url, options);
  const body = await response.clone().json().catch(() => ({}));
  const usage = body.usage;
  calls.push({ model: request.model, effort: request.reasoning_effort, role: request.messages[0].content.includes('vocabulary context') ? 'context' : 'provider-call', status: response.status, latency_ms: Date.now()-start, input_tokens: usage?.prompt_tokens ?? null, cached_tokens: usage?.prompt_tokens_details?.cached_tokens ?? 0, output_tokens: usage?.completion_tokens ?? null, reasoning_tokens: usage?.completion_tokens_details?.reasoning_tokens ?? null, finish_reason: body.choices?.[0]?.finish_reason });
  return response;
};
(async () => {
  const results = [];
  if (process.argv.includes('--dry')) { const d=input();const q=buildQuizQuestions(d);assert.equal(q.length,10);assert(q.some(x=>x.kanjiTarget));console.log(JSON.stringify({dry_run:true,questions:q.length,styles:Object.fromEntries(['meaning','kanji_reading','kanji_orthography'].map(s=>[s,q.filter(x=>x.questionStyle===s).length]))}));return; }
  for (const [condition, model, effort] of [['production-env',cfg.AI_QUIZ_MODEL,cfg.AI_QUIZ_REASONING_EFFORT]]) {
    const data = input();
    data.baseQuestions = buildQuizQuestions(data);
    const baseHash = crypto.createHash('sha256').update(JSON.stringify(data.baseQuestions)).digest('hex');
    const provider = createAiQuizProvider(new ConfigService(cfg));
    const before = calls.length;
    const start = Date.now();
    const questions = await provider.generate(data);
    const list = calls.slice(before);
    assert.equal(questions.length, 10);
    const result = { condition, model, effort, base_question_sha256: baseHash, questions: questions.length, elapsed_ms: Date.now()-start, provider_calls: list.length, context_questions: questions.filter(q => q.context).length, styles: Object.fromEntries(['meaning','kanji_reading','kanji_orthography'].map(s => [s, questions.filter(q => q.questionStyle === s).length])), usage: data.usage, calls: list, generated_questions: questions };
    results.push(result);
    const text = JSON.stringify(results,null,2); assert(!text.includes(key)); fs.writeFileSync(root+'/results.json',text,{mode:0o600});
    console.log(JSON.stringify({ ...result, generated_questions: undefined }));
  }
  assert.equal(cfg.AI_CHAT_MODEL, 'deepseek-ai/deepseek-v4.1-flash'); assert.equal(cfg.AI_CHAT_REASONING_EFFORT, 'none'); assert.equal(cfg.AI_QUIZ_MODEL, 'zai-org/glm-5.3-flash'); assert.equal(cfg.AI_QUIZ_VALIDATOR_MODEL, cfg.AI_QUIZ_MODEL); assert.equal(cfg.AI_QUIZ_TIMEOUT_MS, '60000'); assert(calls.every(c => c.model === cfg.AI_QUIZ_MODEL && c.effort === 'low' && c.status === 200));
  console.log('SUMMARY '+JSON.stringify({ quizzes: results.length, no_config_or_db_mutations: true, pricing_not_invoice: true }));
})().catch(e => { console.error(String(e).split(key).join('[redacted]')); process.exitCode=1; });

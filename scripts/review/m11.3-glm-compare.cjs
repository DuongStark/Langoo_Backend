'use strict';
// M11.3: isolate a snapshot of the existing pilot; never alter its owner files.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const ts = require('typescript');
const root = process.cwd();
const out = path.resolve(process.env.M113_COMPARE_OUTPUT || 'docs/reviews/m11.3-glm-comparison-2026-11-17');
const frozen = fs.mkdtempSync(path.join(os.tmpdir(), 'langoo-m113-compare-'));
const hashes = {};
const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');
const copied = new Set();
function copy(file) {
  file = path.resolve(file);
  if (copied.has(file)) return;
  if (!file.startsWith(root + path.sep)) throw new Error('External source path');
  copied.add(file);
  const rel = path.relative(root, file);
  const source = fs.readFileSync(file, 'utf8');
  hashes[rel] = sha(source);
  let input = source;
  if (rel === 'scripts/ops/m11.3-quiz-pilot.ts') {
    input = input.replace("const control =", "let pilotSeed = 17317;\nconst seededIndex = (max: number) => { pilotSeed = (Math.imul(pilotSeed, 1664525) + 1013904223) >>> 0; return pilotSeed % max; };\nconst control =");
    input = input.replace("'scripts/ops/m11.3-quiz-provider-bridge.cjs',", JSON.stringify(path.join(frozen, 'scripts/ops/m11.3-quiz-provider-bridge.cjs')) + ',');
    input = input.replace('  const started = Date.now(),\n    fromCall = calls.length;', '  pilotSeed = fixture.languageId === 1 ? 17317 : 27117;\n  const started = Date.now(),\n    fromCall = calls.length;');
    input = input.replace('generatorModel: metadata.generatorModel,', 'generatorModel: process.env.QUIZ_PILOT_GENERATOR_MODEL ?? metadata.generatorModel,\n    randomIndex: seededIndex,');
    input = input.replace('validatorModel: metadata.validatorModel,', 'validatorModel: process.env.QUIZ_PILOT_VALIDATOR_MODEL ?? metadata.validatorModel,');
    input = input.replace('        metadata,\n        fixtureKind:', '        metadata,\n        effectiveGeneratorModel: process.env.QUIZ_PILOT_GENERATOR_MODEL ?? metadata.generatorModel,\n        effectiveValidatorModel: process.env.QUIZ_PILOT_VALIDATOR_MODEL ?? metadata.validatorModel,\n        snapshotSource: ' + JSON.stringify(frozen) + ',\n        fixtureKind:');
  }
  const output = ts.transpileModule(input, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true, emitDecoratorMetadata: true },
  }).outputText;
  const target = path.join(frozen, rel.replace(/\.ts$/, '.js'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, output);
  // Resolve only runtime requires in transpiled code, excluding type-only graphs.
  for (const match of output.matchAll(/require\(["'](\.[^"']+)["']\)/g)) {
    const base = path.resolve(path.dirname(file), match[1]);
    const dep = [base + '.ts', path.join(base, 'index.ts')].find((p) => fs.existsSync(p));
    if (!dep) throw new Error('Missing runtime dependency ' + base);
    copy(dep);
  }
}
copy(path.join(root, 'scripts/ops/m11.3-quiz-pilot.ts'));
const bridge = 'scripts/ops/m11.3-quiz-provider-bridge.cjs';
const bridgeBytes = fs.readFileSync(bridge);
hashes[bridge] = sha(bridgeBytes);
fs.copyFileSync(bridge, path.join(frozen, bridge));
fs.symlinkSync(path.join(root, 'node_modules'), path.join(frozen, 'node_modules'), 'dir');
for (const [file, digest] of Object.entries(hashes)) if (sha(fs.readFileSync(file)) !== digest) throw new Error('Source changed during snapshot');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'snapshot.json'), JSON.stringify({ task:'M11.3', date:'2026-11-17', head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(), frozen, source_sha256:hashes, policy:'same source/basic/single/cold/reasoning low; no production writes', seed_en:17317,seed_ja:27117 }, null, 2)+'\n');
const models = [ ['glm', 'zai-org/glm-5.3-flash'], ['deepseek', 'deepseek-ai/deepseek-v4.1-flash'] ];
for (const [name, model] of models) {
  const target = path.join(out, name);
  if (fs.existsSync(target)) throw new Error('Do not overwrite an existing pilot');
  const env = { ...process.env, QUIZ_PILOT_OUTPUT:target, QUIZ_PILOT_MODE:'single', QUIZ_PILOT_PRESET:'basic', QUIZ_PILOT_NO_WARM:'1', QUIZ_PILOT_MAX_CALLS:'16', QUIZ_PILOT_REASONING_EFFORT:'low', QUIZ_PILOT_GENERATOR_MODEL:model, QUIZ_PILOT_VALIDATOR_MODEL:model, QUIZ_PILOT_JUDGE_MODEL:'deepseek-ai/deepseek-v4.1-flash' };
  delete env.QUIZ_PILOT_LANGUAGE; delete env.QUIZ_PILOT_NO_JUDGE;
  const fd=fs.openSync(path.join(out,name+'.log'),'wx',0o600);
  const result=spawnSync(process.execPath,[path.join(frozen,'scripts/ops/m11.3-quiz-pilot.js')],{cwd:root,env,stdio:['ignore',fd,fd],timeout:600000});fs.closeSync(fd);
  console.log(JSON.stringify({model,status:result.status,error:result.error?.code??null,output:target}));
  if (result.status !== 0) process.exitCode = 1;
}

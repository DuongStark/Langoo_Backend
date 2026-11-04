// Review-only reproduction against the unmodified FE source archive.
// node reproduce.cjs <source-root> <query-core-package-dir>
// No real vendor calls; fetch and storage are fully mocked.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(process.argv[2]);
const { QueryClient } = require(path.resolve(process.argv[3]));
const storage = new Map();
const calls = [];
let releaseGoogle;
let privacy;
const windowMock = {};
function load(relative, mocks) {
  const filename = path.join(root, relative);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module, exports: module.exports,
    require: name => {
      if (!(name in mocks)) throw Error('Unexpected import: ' + name);
      return mocks[name];
    },
    console: { warn() {} }, window: windowMock, crypto: require('node:crypto').webcrypto,
    AbortSignal, Date, Set, Promise, URL, setTimeout, clearTimeout,
    fetch: async (url) => {
      calls.push({ vendor: new URL(url).hostname, stateAtDispatch: privacy.privacyStore.get().online_translation });
      if (calls.length === 1) return new Promise(resolve => { releaseGoogle = resolve; });
      return { ok: true, json: async () => ({ responseData: { translatedText: 'mau dich' } }) };
    },
  }, { filename });
  return module.exports;
}
(async () => {
  privacy = load('src/lib/privacy.ts', {
    '@/lib/storage': { readStorage: k => storage.get(k) ?? null, writeStorage: (k, v) => storage.set(k, v) },
  });
  const tr = load('src/lib/translate.ts', { '@/lib/privacy': privacy, '@/lib/storage': { storage: { getJSON: () => null, setJSON() {} } } });
  privacy.privacyStore.set({ online_translation: 'granted' });
  const translation = tr.translateText('benign review fixture', 'en', 'vi');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
  privacy.privacyStore.set({ online_translation: 'withdrawn' });
  releaseGoogle({ ok: false });
  await translation;
  assert.ok(calls.slice(1).some(c => c.stateAtDispatch === 'withdrawn'));

  const choices = { analytics: { action: 'grant', version: 'old-version', updated_at: '2020-01-01' } };
  const guestWithoutManifest = privacy.guestStateOf(choices, 'analytics', null);
  assert.equal(guestWithoutManifest, 'granted');

  const current = { notice_version: '2026-11-03-v1' };
  const aState = { choices: [{ purpose_id: 'online_translation', state: 'granted', latest_event: { notice_version: current.notice_version } }] };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const key = ['privacy', 'state'];
  await client.fetchQuery({ queryKey: key, queryFn: async () => aState, staleTime: 30000 });
  let bFetches = 0;
  const bSees = await client.fetchQuery({ queryKey: key, queryFn: async () => { bFetches++; return { choices: [] }; }, staleTime: 30000 });
  assert.equal(bFetches, 0);
  assert.equal(privacy.accountStateOf(bSees, 'online_translation', current), 'granted');

  await assert.rejects(client.fetchQuery({ queryKey: key, queryFn: async () => { throw Error('simulated 503'); }, staleTime: 0 }));
  const afterError = client.getQueryState(key);
  const stateAfter503 = privacy.accountStateOf(afterError.data, 'online_translation', current);
  assert.equal(afterError.status, 'error');
  assert.equal(stateAfter503, 'granted');
  client.clear();
  console.log(JSON.stringify({
    translationCalls: calls,
    guestOldGrantWithoutManifest: guestWithoutManifest,
    accountSwitch: { nextAccountFetches: bFetches, nextAccountChoice: privacy.accountStateOf(bSees, 'online_translation', current) },
    refetch503: { queryStatus: afterError.status, choiceStill: stateAfter503 },
    outcome: '4 undesired behaviors reproduced with actual FE helpers; no real vendor requests',
  }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });

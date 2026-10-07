import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { ArtifactPath, PilotManifestSchema } from './_mapping-types';
import {
  JsonlWriter,
  readBytes,
  resolveArtifact,
  sha256Bytes,
  sha256File,
  stablePretty,
  writeTextAtomic,
} from './_artifacts';
import { ExportManifestSchema, type ExportManifest } from './_export';
import {
  createMappingBundle,
  mappingTargetKey,
  parseMappingCandidate,
  type ArtifactRef,
  type MappingBundle,
  type MappingCandidate,
} from './_mapping-types';

/**
 * D2 (bundle artifact) — gom candidate `ready` thành `MappingBundle` 1..5/sense:
 *   bundles/<generation>/items/<bundleKey>.json  (ref per-entry cho job)
 *   bundles/<generation>/bundles.jsonl           (danh sách để soi)
 *   bundles/<generation>/manifest.json           (entry point + refs + required snapshot/pilot)
 * Kèm snapshot artifact + pilot manifest placeholder (D5 thay bằng mẫu pilot thật).
 * Offline; deterministic; idempotent theo bytes.
 */

const BUILDER_VERSION = 'db4-bundle-v1';
const POLICY_VERSION = 'mapping-policy-v1';
const SEED = 'db4-pilot-seed-v1';

interface CandidatesSummary {
  kind: string;
  generatorVersion: string;
  export: ArtifactRef;
  files: ArtifactRef[];
  counts: { senses: number; candidates: number; unresolved: number };
}

function parseCliFlags(argv: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Tham số lạ: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--'))
      throw new Error(`Thiếu giá trị cho --${key}`);
    flags.set(key, value);
    index += 1;
  }
  return flags;
}

function writeItemFile(root: string, rel: string, text: string): ArtifactRef {
  const abs = resolveArtifact(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, text);
  return { path: rel, sha256: sha256Bytes(text) };
}

function latestSummaryRel(root: string): string {
  const dir = resolveArtifact(root, 'candidates');
  const generations = readdirSync(dir)
    .filter((name) => !name.startsWith('.tmp-'))
    .sort();
  const last = generations[generations.length - 1];
  if (!last) throw new Error('Chưa có generation trong candidates/');
  return `candidates/${last}/summary.json`;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const started = Date.now();
  const flags = parseCliFlags(argv);
  for (const key of flags.keys())
    if (!['artifact-dir', 'candidates'].includes(key))
      throw new Error(`Flag không hỗ trợ: --${key}`);
  const root = path.resolve(flags.get('artifact-dir') ?? 'uploads/db4');
  const summaryRel = flags.get('candidates') ?? latestSummaryRel(root);
  ArtifactPath.parse(summaryRel);

  const summaryBytes = readBytes(root, summaryRel);
  const summary = JSON.parse(
    summaryBytes.toString('utf8'),
  ) as CandidatesSummary;
  if (summary.kind !== 'db4-candidates')
    throw new Error(`Summary không phải db4-candidates: ${summary.kind}`);
  const pairsRef = summary.files.find((file) =>
    file.path.endsWith('/pairs.jsonl'),
  );
  if (!pairsRef) throw new Error('Summary thiếu pairs.jsonl');
  if (sha256File(resolveArtifact(root, pairsRef.path)) !== pairsRef.sha256)
    throw new Error('pairs.jsonl lệch sha so với summary');
  const exportBytes = readBytes(root, summary.export.path);
  if (sha256Bytes(exportBytes) !== summary.export.sha256)
    throw new Error('Export manifest lệch sha so với summary');
  const exportManifest: ExportManifest = ExportManifestSchema.parse(
    JSON.parse(exportBytes.toString('utf8')),
  );
  if (exportManifest.mode !== 'production')
    throw new Error('Bundles chỉ hỗ trợ mode production');
  const fingerprint = exportManifest.semanticInputFingerprint;

  const generation = `${fingerprint.slice(0, 16)}-${BUILDER_VERSION}`;
  const finalRel = `bundles/${generation}`;
  const tmpRel = `bundles/.tmp-${process.pid}`;
  const bundleWriter = new JsonlWriter(root, `${tmpRel}/bundles.jsonl`);
  const entries: {
    bundleKey: string;
    targetKey: string;
    senseKey: string;
    contextHash: string;
    ref: ArtifactRef;
    candidateCount: number;
  }[] = [];
  const strata: {
    targetKey: string;
    jlptLevel: number | null;
    isPrimary: boolean;
    lexemeKey: string;
  }[] = [];

  let current: MappingCandidate[] = [];
  let currentSenseKey: string | null = null;
  const seenSenses = new Set<string>();
  let bundles = 0;
  let skipped = 0;

  const flush = (): void => {
    if (current.length === 0) return;
    const flushSenseKey = current[0].sense.semanticKey;
    if (seenSenses.has(flushSenseKey))
      throw new Error(`pairs.jsonl không gom theo sense: ${flushSenseKey}`);
    seenSenses.add(flushSenseKey);
    const first = current[0];
    const bundle: MappingBundle = createMappingBundle(current, BUILDER_VERSION);
    const itemRel = `${tmpRel}/items/${bundle.bundleKey}.json`;
    const ref = writeItemFile(root, itemRel, stablePretty(bundle));
    bundleWriter.write(bundle);
    const targetKey = mappingTargetKey(bundle.sense.semanticKey, fingerprint);
    entries.push({
      bundleKey: bundle.bundleKey,
      targetKey,
      senseKey: bundle.sense.semanticKey,
      contextHash: bundle.contextHash,
      ref,
      candidateCount: bundle.candidates.length,
    });
    const identity = first.sense.identity;
    strata.push({
      targetKey,
      jlptLevel: first.sense.jlptLevel,
      isPrimary: first.sense.isPrimary,
      lexemeKey: identity
        ? `jmdict:${identity.externalId}`
        : `sense:${first.sense.semanticKey.slice(6, 18)}`,
    });
    bundles += 1;
    current = [];
  };

  const rl = createInterface({
    input: createReadStream(resolveArtifact(root, pairsRef.path)),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line) continue;
    const candidate = parseMappingCandidate(JSON.parse(line));
    if (candidate.mode !== exportManifest.mode)
      throw new Error('Candidate khác mode với export');
    if (candidate.semanticInputFingerprint !== fingerprint)
      throw new Error('Candidate khác fingerprint với export');
    if (currentSenseKey !== candidate.sense.semanticKey) {
      flush();
      currentSenseKey = candidate.sense.semanticKey;
    }
    if (candidate.classification === 'ready') current.push(candidate);
    else skipped += 1;
  }
  flush();
  if (bundles === 0) throw new Error('Không có bundle nào để ghi');
  const bundleFile = bundleWriter.close();

  const snapshotRef = writeTextAtomic(
    root,
    `snapshots/${fingerprint.slice(0, 16)}.json`,
    stablePretty(exportManifest.snapshot),
  );
  const targetKeys = entries.map((entry) => entry.targetKey).sort();
  const pilotRaw = {
    schemaVersion: 1,
    mode: 'production' as const,
    pilot: 'B' as const,
    semanticInputFingerprint: fingerprint,
    policyVersion: POLICY_VERSION,
    seed: SEED,
    targetKeys,
    positiveTargetKeys: [] as string[],
    hardNegativeTargetKeys: [] as string[],
    strata: [...strata].sort((a, b) => (a.targetKey < b.targetKey ? -1 : 1)),
    exclusions: [] as { targetKey: string; reason: string }[],
  };
  const pilot = PilotManifestSchema.parse(pilotRaw);
  const pilotRef = writeTextAtomic(
    root,
    `pilots/${fingerprint.slice(0, 16)}-all.json`,
    stablePretty(pilot),
  );

  const remap = (ref: ArtifactRef): ArtifactRef => ({
    path: ref.path.replace(`${tmpRel}/`, `${finalRel}/`),
    sha256: ref.sha256,
  });
  const manifest = {
    kind: 'db4-bundles',
    schemaVersion: 1,
    mode: 'production',
    semanticInputFingerprint: fingerprint,
    builderVersion: BUILDER_VERSION,
    policyVersion: POLICY_VERSION,
    seed: SEED,
    candidates: { path: summaryRel, sha256: sha256Bytes(summaryBytes) },
    export: { path: summary.export.path, sha256: summary.export.sha256 },
    snapshot: snapshotRef,
    pilot: pilotRef,
    counts: {
      senses: entries.length,
      bundles,
      skippedCandidates: skipped,
      candidateTotal: summary.counts.candidates,
    },
    bundles: entries.map((entry) => ({ ...entry, ref: remap(entry.ref) })),
    files: [remap(bundleFile.ref), snapshotRef, pilotRef],
  };
  writeTextAtomic(root, `${tmpRel}/manifest.json`, stablePretty(manifest));
  const tmpAbs = resolveArtifact(root, tmpRel);
  const finalAbs = resolveArtifact(root, finalRel);
  if (existsSync(finalAbs)) {
    const existing = readBytes(root, `${finalRel}/manifest.json`);
    const created = readBytes(root, `${tmpRel}/manifest.json`);
    if (sha256Bytes(existing) !== sha256Bytes(created))
      throw new Error(
        `Generation bundles đã tồn tại khác nội dung: ${finalRel}`,
      );
    rmSync(tmpAbs, { recursive: true, force: true });
  } else {
    renameSync(tmpAbs, finalAbs);
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log('== DB4 mapping-bundles ==');
  console.log(
    `  bundles: ${bundles} | senses: ${entries.length} | candidates gom: ${entries.reduce((sum, entry) => sum + entry.candidateCount, 0)} | bỏ (không ready): ${skipped}`,
  );
  console.log(`  dir: ${finalRel} (${seconds}s)`);
  console.log(`  entry point: ${finalRel}/manifest.json`);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(
      `mapping-bundles: LỖI — ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}

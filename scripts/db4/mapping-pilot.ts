import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  readBytes,
  resolveArtifact,
  sha256Bytes,
  stablePretty,
  writeTextAtomic,
} from './_artifacts';
import {
  ArtifactRefSchema,
  hashJson,
  mappingTargetKey,
  parseMappingJob,
  parsePilotManifest,
  verifyArtifactBytes,
  type ArtifactRef,
} from './_mapping-types';
import {
  BundlesManifestSchema,
  samplePilotA,
  type PilotPopulationEntry,
} from './_pilot';

/**
 * `mapping-pilot` — sinh Pilot A manifest theo plan §12.1 (deterministic, offline):
 *
 *   npx tsx scripts/db4/mapping-pilot.ts --bundles bundles/<gen>/manifest.json \
 *     [--artifact-dir uploads/db4] [--seed <text>] [--size 20]
 *
 * Kết quả (idempotent theo bytes):
 *   pilots/<fp16>-pilot-a.json           PilotManifest: 100 target (20/level, 10 primary + 10 secondary)
 *   pilots/<fp16>-pilot-a.manifest.json  bundles manifest con (đúng 100 row) trỏ pilot-a → chạy mapping-review
 *
 * Category coverage (POS/đa nghĩa/lemma dài/gloss/form) lấy từ export sense-context.jsonl;
 * các category không suy được từ metadata (named entity, negation, raw POS ≠ lexeme POS…) ghi ở report/audit.
 */

function parseCliFlags(argv: readonly string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--') || token.includes('='))
      throw new Error(`Tham số lạ: ${token}`);
    const key = token.slice(2);
    if (!['artifact-dir', 'bundles', 'seed', 'size', 'from-job'].includes(key))
      throw new Error(`Flag không hỗ trợ: --${key}`);
    const value = argv[++i];
    if (!value || value.startsWith('--'))
      throw new Error(`Thiếu giá trị: --${key}`);
    flags.set(key, value);
  }
  return flags;
}

interface SenseFeatures {
  normalizedPos: string[];
  lemmaLen: number;
  glossCount: number;
  formsCount: number;
}

export function main(argv = process.argv.slice(2)): void {
  const started = Date.now();
  const flags = parseCliFlags(argv);
  const root = path.resolve(flags.get('artifact-dir') ?? 'uploads/db4');
  const bundlesRel = flags.get('bundles');
  if (!bundlesRel) throw new Error('Thiếu --bundles <manifest>');
  if (!/\.json$/.test(bundlesRel))
    throw new Error('--bundles phải là file .json');

  const manifestBytes = readBytes(root, bundlesRel);
  const raw = JSON.parse(manifestBytes.toString('utf8')) as Record<
    string,
    unknown
  >;
  const manifest = BundlesManifestSchema.parse(raw);
  if (manifest.mode !== 'production')
    throw new Error('Pilot chỉ hỗ trợ mode production');
  const fingerprint = manifest.semanticInputFingerprint;
  const seed = flags.get('seed') ?? manifest.seed;
  const perLevel = flags.has('size') ? Number(flags.get('size')) : 20;
  if (!Number.isSafeInteger(perLevel) || perLevel < 2 || perLevel > 60)
    throw new Error('--size phải là số chẵn 2..60');
  const primaryShare = perLevel / 2;

  for (const ref of [manifest.snapshot, manifest.pilot])
    verifyArtifactBytes(ref, readBytes(root, ref.path));
  const strataManifest = parsePilotManifest(
    JSON.parse(readBytes(root, manifest.pilot.path).toString('utf8')),
  );
  const strata = new Map(
    strataManifest.strata.map((row) => [row.targetKey, row]),
  );

  const fromJobRel = flags.get('from-job');
  if (fromJobRel) {
    const fromJobRels = fromJobRel
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const jobs = fromJobRels.map((rel) => ({
      rel,
      job: parseMappingJob(JSON.parse(readBytes(root, rel).toString('utf8'))),
    }));
    const ready = new Set<string>();
    const known = new Set<string>();
    for (const { job } of jobs)
      for (const entry of job.entries) {
        known.add(entry.targetKey);
        if (entry.state === 'decision_ready') ready.add(entry.targetKey);
      }
    const retryKeys = [...known].filter((key) => !ready.has(key)).sort();
    if (!retryKeys.length) throw new Error('Không có target cần retry');
    const retrySet = new Set(retryKeys);
    const pilot = parsePilotManifest({
      ...strataManifest,
      targetKeys: retryKeys,
      positiveTargetKeys: strataManifest.positiveTargetKeys.filter((key) =>
        retrySet.has(key),
      ),
      hardNegativeTargetKeys: strataManifest.hardNegativeTargetKeys.filter(
        (key) => retrySet.has(key),
      ),
      strata: [...strataManifest.strata]
        .filter((row) => retrySet.has(row.targetKey))
        .sort((a, b) => (a.targetKey < b.targetKey ? -1 : 1)),
      exclusions: [],
    });
    const fp16 = fingerprint.slice(0, 16);
    const pilotRel = `pilots/${fp16}-pilot-a-retry.json`;
    const pilotBytes = stablePretty(pilot);
    writeTextAtomic(root, pilotRel, pilotBytes);
    const pilotRef = { path: pilotRel, sha256: sha256Bytes(pilotBytes) };
    const rowByTarget = new Map(
      manifest.bundles.map((row) => [row.targetKey, row]),
    );
    const rows = retryKeys.map((targetKey) => {
      const row = rowByTarget.get(targetKey);
      if (!row) throw new Error(`Thiếu bundle row cho target ${targetKey}`);
      return row;
    });
    const subsetRel = `pilots/${fp16}-pilot-a-retry.manifest.json`;
    const subsetBytes = stablePretty({
      ...raw,
      pilot: pilotRef,
      bundles: rows,
      counts: { bundles: rows.length, senses: rows.length },
      pilotSample: {
        kind: 'db4-pilot-a-retry-v1',
        fromJob: { path: fromJobRel },
        sourceManifest: {
          path: bundlesRel,
          sha256: sha256Bytes(manifestBytes),
        },
      },
    });
    BundlesManifestSchema.parse(JSON.parse(subsetBytes));
    writeTextAtomic(root, subsetRel, subsetBytes);
    console.log('== DB4 mapping-pilot (A retry) ==');
    console.log(
      `  target cần retry: ${rows.length} (đã xong ${ready.size}/${known.size}, từ ${fromJobRels.length} job)`,
    );
    console.log(`  pilot: ${pilotRel}`);
    console.log(`  manifest: ${subsetRel}`);
    return;
  }

  const exportRef = ArtifactRefSchema.parse(raw.export);
  verifyArtifactBytes(exportRef, readBytes(root, exportRef.path));
  const exportManifest = JSON.parse(
    readBytes(root, exportRef.path).toString('utf8'),
  ) as { files?: unknown };
  const files = (exportManifest.files ?? []) as unknown[];
  const senseContextRel = files
    .map((value) => ArtifactRefSchema.safeParse(value))
    .find(
      (parsed) =>
        parsed.success && parsed.data.path.endsWith('/sense-context.jsonl'),
    );
  if (!senseContextRel || !senseContextRel.success)
    throw new Error('Export manifest thiếu sense-context.jsonl');
  const senseContextRef: ArtifactRef = senseContextRel.data;
  verifyArtifactBytes(senseContextRef, readBytes(root, senseContextRef.path));

  const lexemeCount = new Map<string, number>();
  for (const row of manifest.bundles) {
    const stratum = strata.get(row.targetKey);
    if (!stratum) continue;
    lexemeCount.set(
      stratum.lexemeKey,
      (lexemeCount.get(stratum.lexemeKey) ?? 0) + 1,
    );
  }

  const features = new Map<string, SenseFeatures>();
  for (const line of readBytes(root, senseContextRef.path)
    .toString('utf8')
    .split('\n')) {
    if (!line.trim()) continue;
    const record = JSON.parse(line) as {
      sense?: { semanticKey?: unknown; lemma?: unknown };
      metadata?: { normalizedPos?: unknown };
      glosses?: unknown;
    };
    const semanticKey = record.sense?.semanticKey;
    if (typeof semanticKey !== 'string') continue;
    const lemma =
      typeof record.sense?.lemma === 'string' ? record.sense.lemma : '';
    const normalizedPos = Array.isArray(record.metadata?.normalizedPos)
      ? (record.metadata.normalizedPos as unknown[]).filter(
          (value): value is string => typeof value === 'string',
        )
      : [];
    features.set(semanticKey, {
      normalizedPos,
      lemmaLen: [...lemma].length,
      glossCount: Array.isArray(record.glosses) ? record.glosses.length : 0,
      formsCount: Array.isArray(
        (record.sense as { forms?: unknown } | undefined)?.forms,
      )
        ? (record.sense as { forms: unknown[] }).forms.length
        : 0,
    });
  }

  const skipped: string[] = [];
  const population: PilotPopulationEntry[] = [];
  for (const row of manifest.bundles) {
    const stratum = strata.get(row.targetKey);
    const feature = features.get(row.senseKey);
    if (!stratum || !feature) {
      skipped.push(row.targetKey);
      continue;
    }
    if (
      stratum.jlptLevel === null ||
      ![1, 2, 3, 4, 5].includes(stratum.jlptLevel)
    ) {
      skipped.push(row.targetKey);
      continue;
    }
    population.push({
      targetKey: row.targetKey,
      jlptLevel: stratum.jlptLevel as 1 | 2 | 3 | 4 | 5,
      isPrimary: stratum.isPrimary,
      lexemeKey: stratum.lexemeKey,
      features: {
        normalizedPos: feature.normalizedPos,
        multiSenseLexeme: (lexemeCount.get(stratum.lexemeKey) ?? 0) > 1,
        longLemma: feature.lemmaLen >= 3,
        manyGlosses: feature.glossCount >= 3,
        manyForms: feature.formsCount >= 3,
      },
    });
  }

  const sample = samplePilotA(population, { seed, perLevel, primaryShare });
  const fp16 = fingerprint.slice(0, 16);
  const pilotRel = `pilots/${fp16}-pilot-a.json`;
  const pilot = parsePilotManifest({
    schemaVersion: 1,
    mode: manifest.mode,
    pilot: 'A',
    semanticInputFingerprint: fingerprint,
    policyVersion: manifest.policyVersion,
    seed,
    targetKeys: sample.targetKeys,
    positiveTargetKeys: [],
    hardNegativeTargetKeys: [],
    strata: sample.strata,
    exclusions: [],
  });
  const existingPilot = resolveArtifact(root, pilotRel);
  const pilotBytes = stablePretty(pilot);
  if (!(
    existsSafe(existingPilot) &&
    readFileSync(existingPilot, 'utf8') === pilotBytes
  ))
    writeTextAtomic(root, pilotRel, pilotBytes);
  const pilotRef: ArtifactRef = {
    path: pilotRel,
    sha256: sha256Bytes(pilotBytes),
  };

  const rowByTarget = new Map(
    manifest.bundles.map((row) => [row.targetKey, row]),
  );
  const rows = sample.targetKeys.map((targetKey) => {
    const row = rowByTarget.get(targetKey);
    if (!row) throw new Error(`Thiếu bundle row cho target ${targetKey}`);
    if (row.targetKey !== mappingTargetKey(row.senseKey, fingerprint))
      throw new Error(`targetKey không khớp sense/fingerprint: ${targetKey}`);
    return row;
  });
  const subsetRel = `pilots/${fp16}-pilot-a.manifest.json`;
  const subset = {
    ...raw,
    pilot: pilotRef,
    bundles: rows,
    counts: { bundles: rows.length, senses: rows.length },
    pilotSample: {
      kind: 'db4-pilot-a-sample-v1',
      seed,
      perLevel,
      primaryShare,
      coverage: sample.coverage,
      required: sample.required,
      unfulfilled: sample.unfulfilled,
      notes: sample.notes,
      skipped,
      sourceManifest: { path: bundlesRel, sha256: sha256Bytes(manifestBytes) },
    },
  };
  BundlesManifestSchema.parse(subset);
  const subsetAbs = resolveArtifact(root, subsetRel);
  const subsetBytes = stablePretty(subset);
  if (!(
    existsSafe(subsetAbs) && readFileSync(subsetAbs, 'utf8') === subsetBytes
  ))
    writeTextAtomic(root, subsetRel, subsetBytes);

  const byLevel = new Map<string, number>();
  for (const row of sample.strata)
    byLevel.set(
      `JLPT${row.jlptLevel}/${row.isPrimary ? 'primary' : 'secondary'}`,
      (byLevel.get(
        `JLPT${row.jlptLevel}/${row.isPrimary ? 'primary' : 'secondary'}`,
      ) ?? 0) + 1,
    );
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log('== DB4 mapping-pilot (A) ==');
  console.log(
    `  mẫu: ${sample.targetKeys.length} target | seed ${seed} | ${seconds}s`,
  );
  console.log(
    `  strata: ${[...byLevel.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, count]) => `${key}=${count}`)
      .join(' ')}`,
  );
  console.log(
    `  coverage: ${Object.entries(sample.coverage)
      .map(([key, count]) => `${key} ${count}/${sample.required[key]}`)
      .join(' | ')}`,
  );
  if (sample.unfulfilled.length)
    console.log(`  CHƯA ĐỦ: ${sample.unfulfilled.join(', ')}`);
  if (sample.notes.length)
    for (const note of sample.notes) console.log(`  note: ${note}`);
  if (skipped.length)
    console.log(`  bỏ (thiếu stratum/feature): ${skipped.length}`);
  console.log(`  pilot manifest: ${pilotRel}`);
  console.log(`  job manifest:   ${subsetRel} (${rows.length} bundle)`);
  console.log(`  pilotManifestHash: ${hashJson(pilot)}`);
}

function existsSafe(abs: string): boolean {
  try {
    readFileSync(abs);
    return true;
  } catch {
    return false;
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(
      `mapping-pilot: LỖI — ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

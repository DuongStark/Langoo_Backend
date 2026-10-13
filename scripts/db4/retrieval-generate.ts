// DB4-D2 artifact builder; emits D1 candidates/bundles without provider calls.
// Output rows are streamed per sense so the full cohort does not need to fit in memory.
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmdirSync,
  writeSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { hashBytes, semanticInputFingerprint } from './_mapping-types';
import {
  RETRIEVAL_VERSION,
  SearchManifestSchema,
  SearchResultSchema,
  artifactPath,
  auditedSources,
  bundleReady,
  cliFlags,
  jsonLines,
  loadExport,
  makeCandidate,
  readArtifact,
  sourceIdentity,
  writeJson,
} from './_retrieval';

export async function runGenerate(flags: Record<string, string>) {
  const root = resolve(flags['artifact-dir'] ?? 'uploads/db4');
  for (const key of ['export', 'audit', 'search'])
    if (!flags[key]) throw new Error(`Missing --${key}`);
  const searchBytes = readFileSync(artifactPath(root, flags.search));
  const search = SearchManifestSchema.parse(JSON.parse(searchBytes.toString()));
  const results = jsonLines(
    readArtifact(root, search.results),
    SearchResultSchema,
  );
  const exported = await loadExport(
    root,
    flags.export,
    new Set(results.flatMap((r) => r.hits.map((h) => h.conceptId))),
  );
  const audit = auditedSources(root, flags.audit, exported);
  if (
    exported.manifest.snapshot.mode === 'production' &&
    results.some((r) => r.hits.length) &&
    (!search.modelFiles.some((ref) => ref.path.endsWith('.onnx')) ||
      !search.modelFiles.some((ref) => ref.path.endsWith('/tokenizer.json')))
  )
    throw new Error(
      'Production semantic retrieval needs actual model artifacts',
    );
  if (
    search.exportSha256 !== hashBytes(exported.bytes) ||
    search.auditSha256 !== hashBytes(audit.bytes)
  )
    throw new Error('Retrieval used another export/source audit');
  search.modelFiles.forEach((ref) => readArtifact(root, ref));
  if (results.length !== exported.senses.length)
    throw new Error('Retrieval denominator mismatch');
  const resultByKey = new Map(results.map((r) => [r.senseKey, r]));
  if (resultByKey.size !== results.length)
    throw new Error('Duplicate retrieval sense');
  const conceptById = new Map(exported.concepts.map((c) => [c.concept.id, c]));
  const snapshot = {
    ...exported.manifest.snapshot,
    sourcePolicyVersion: `db4-d2-source-audit-v1:${hashBytes(audit.bytes)}`,
  };
  const fingerprint = semanticInputFingerprint(snapshot);
  const prefix = flags.prefix ?? 'generation';
  const stageRel = `${prefix}.partial-${process.pid}`;
  const stageRoot = artifactPath(root, stageRel);
  mkdirSync(stageRoot, { recursive: true });
  interface RowStream {
    rel: string;
    stagePath: string;
    fd: number;
    hash: ReturnType<typeof createHash>;
    count: number;
  }
  const openStream = (name: string): RowStream => {
    const stagePath = `${stageRel}/${name}`;
    const target = artifactPath(root, stagePath);
    mkdirSync(dirname(target), { recursive: true });
    return {
      rel: `${prefix}/${name}`,
      stagePath,
      fd: openSync(target, 'wx', 0o600),
      hash: createHash('sha256'),
      count: 0,
    };
  };
  const writeRow = (stream: RowStream, row: unknown): void => {
    const line = JSON.stringify(row) + '\n';
    writeSync(stream.fd, line);
    stream.hash.update(line);
    stream.count += 1;
  };
  const closeStream = (stream: RowStream): { path: string; sha256: string } => {
    fsyncSync(stream.fd);
    closeSync(stream.fd);
    return { path: stream.rel, sha256: stream.hash.digest('hex') };
  };
  const candidates = openStream('candidates.jsonl');
  const bundles = openStream('bundles.jsonl');
  const identities = openStream('source-identity.jsonl');
  const statuses = openStream('status.jsonl');
  const statusCounts: Record<string, number> = {};
  const writeStatus = (row: Record<string, unknown>): void => {
    writeRow(statuses, row);
    const status = String(row.status);
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
  };
  let processed = 0;
  for (const s of exported.senses) {
    processed += 1;
    if (processed % 1000 === 0)
      console.log(JSON.stringify({ processed, total: exported.senses.length }));
    const result = resultByKey.get(s.sense.semanticKey);
    if (!result || result.senseId !== s.sense.id)
      throw new Error('Missing or mismatched retrieval sense');
    if (
      new Set(result.hits.map((h) => h.conceptId)).size !== result.hits.length
    )
      throw new Error('Duplicate hit concept');
    const identity = sourceIdentity(s, exported.concepts, audit.sources);
    writeRow(identities, {
      senseKey: s.sense.semanticKey,
      senseId: s.sense.id,
      semanticInputFingerprint: fingerprint,
      ...identity,
      sourceAuditSha256: hashBytes(audit.bytes),
    });
    if (
      ['existing_source_link', 'source_identity_proposal'].includes(
        identity.status,
      )
    ) {
      writeStatus({
        senseKey: s.sense.semanticKey,
        senseId: s.sense.id,
        status: identity.status,
        bundleKey: null,
      });
      continue;
    }
    if (s.wordnetIdentity) {
      writeStatus({
        senseKey: s.sense.semanticKey,
        senseId: s.sense.id,
        status:
          identity.status === 'blocked_source'
            ? 'blocked_source'
            : 'unresolved_source_identity',
        reason:
          'reason' in identity
            ? identity.reason
            : 'Source identity requires audit.',
        bundleKey: null,
      });
      continue;
    }
    // Any existing exact link stays owned by its original run/source. D3/D6 must inspect it.
    if (s.existingLinks.some((l) => l.relation === 'exact')) {
      writeStatus({
        senseKey: s.sense.semanticKey,
        senseId: s.sense.id,
        status: 'existing_exact_requires_audit',
        bundleKey: null,
      });
      continue;
    }
    const selected = result.hits.map((hit, index) => {
      const concept = conceptById.get(hit.conceptId);
      if (!concept) throw new Error('Foreign retrieval concept');
      return makeCandidate(
        s,
        concept,
        audit.sources,
        fingerprint,
        index + 1,
        hit.score,
        hit.branches,
        {
          ...hit.features,
          model: search.model,
          revision: search.revision,
          searchManifestSha256: hashBytes(searchBytes),
        },
        snapshot.mode,
      );
    });
    for (const candidate of selected) writeRow(candidates, candidate);
    const bundle = bundleReady(selected);
    if (bundle) writeRow(bundles, bundle);
    const blocked = s.sourceKeys.some(
      (key) =>
        audit.sources.find((source) => source.key === key)?.audit.status !==
        'verified',
    );
    writeStatus({
      senseKey: s.sense.semanticKey,
      senseId: s.sense.id,
      status: bundle
        ? 'ready'
        : blocked
          ? 'blocked_source'
          : !s.sense.identity
            ? 'missing_identity'
            : !s.senseContext.enGlosses.length &&
                !s.senseContext.definitions.length
              ? 'missing_context'
              : selected.length
                ? 'no_ready_candidates'
                : 'no_candidates',
      bundleKey: bundle?.bundleKey ?? null,
      reason: result.reason,
      candidateCount: selected.length,
    });
  }
  const files = {
    candidates: closeStream(candidates),
    bundles: closeStream(bundles),
    sourceIdentity: closeStream(identities),
    status: closeStream(statuses),
  };
  mkdirSync(artifactPath(root, prefix), { recursive: true });
  for (const stream of [candidates, bundles, identities, statuses])
    renameSync(
      artifactPath(root, stream.stagePath),
      artifactPath(root, stream.rel),
    );
  rmdirSync(artifactPath(root, stageRel));
  const counts = {
    senses: statuses.count,
    candidates: candidates.count,
    bundles: bundles.count,
    statuses: statusCounts,
  };
  const manifest = {
    schemaVersion: 1,
    task: 'db4_retrieval_generation',
    version: RETRIEVAL_VERSION,
    createdAt: new Date().toISOString(),
    snapshot,
    semanticInputFingerprint: fingerprint,
    inputs: {
      export: { path: flags.export, sha256: hashBytes(exported.bytes) },
      audit: { path: flags.audit, sha256: hashBytes(audit.bytes) },
      search: { path: flags.search, sha256: hashBytes(searchBytes) },
    },
    files,
    counts,
    apply: false,
    semanticQualityValidated: false,
  };
  const ref = writeJson(root, `${prefix}/manifest.json`, manifest);
  console.log(JSON.stringify({ manifest: ref, counts, apply: false }));
  return manifest;
}
if (require.main === module) {
  void runGenerate(
    cliFlags(process.argv.slice(2), [
      'artifact-dir',
      'export',
      'audit',
      'search',
      'prefix',
    ]),
  ).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

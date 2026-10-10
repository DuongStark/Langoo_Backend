// DB4-D2 artifact builder; emits D1 candidates/bundles without provider calls.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MappingCandidate,
  MappingBundle,
  hashBytes,
  semanticInputFingerprint,
} from './_mapping-types';
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
  writeArtifact,
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
  const candidates: MappingCandidate[] = [];
  const bundles: MappingBundle[] = [];
  const identities: unknown[] = [];
  const statuses: unknown[] = [];
  for (const s of exported.senses) {
    const result = resultByKey.get(s.sense.semanticKey);
    if (!result || result.senseId !== s.sense.id)
      throw new Error('Missing or mismatched retrieval sense');
    if (
      new Set(result.hits.map((h) => h.conceptId)).size !== result.hits.length
    )
      throw new Error('Duplicate hit concept');
    const identity = sourceIdentity(s, exported.concepts, audit.sources);
    identities.push({
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
      statuses.push({
        senseKey: s.sense.semanticKey,
        senseId: s.sense.id,
        status: identity.status,
        bundleKey: null,
      });
      continue;
    }
    if (s.wordnetIdentity) {
      statuses.push({
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
      statuses.push({
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
    candidates.push(...selected);
    const bundle = bundleReady(selected);
    if (bundle) bundles.push(bundle);
    const blocked = s.sourceKeys.some(
      (key) =>
        audit.sources.find((source) => source.key === key)?.audit.status !==
        'verified',
    );
    statuses.push({
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
  const prefix = flags.prefix ?? 'generation';
  const lines = (rows: unknown[]) =>
    rows.map((row) => JSON.stringify(row) + '\n').join('');
  const files = {
    candidates: writeArtifact(
      root,
      `${prefix}/candidates.jsonl`,
      lines(candidates),
    ),
    bundles: writeArtifact(root, `${prefix}/bundles.jsonl`, lines(bundles)),
    sourceIdentity: writeArtifact(
      root,
      `${prefix}/source-identity.jsonl`,
      lines(identities),
    ),
    status: writeArtifact(root, `${prefix}/status.jsonl`, lines(statuses)),
  };
  const counts = {
    senses: statuses.length,
    candidates: candidates.length,
    bundles: bundles.length,
    statuses: statuses.reduce<Record<string, number>>((acc, value) => {
      const status = (value as { status: string }).status;
      acc[status] = (acc[status] ?? 0) + 1;
      return acc;
    }, {}),
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

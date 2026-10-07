/** DB4-D0.3: read-only WordNet shortlist + FK counts. Never emits DELETE SQL. */
import type { Client } from 'pg';
import { hash } from './source-projection';

interface Pair {
  keep_sense_id: string;
  other_sense_id: string;
  keep_lexeme_id: string;
  other_lexeme_id: string;
  concept_id: string;
  keep_scope: unknown;
  other_scope: unknown;
  keep_source: unknown;
  other_source: unknown;
}
interface ForeignKey {
  schema: string;
  table: string;
  column: string;
  referenced: string;
  name: string;
  supported: boolean;
}
const scope = (sense: string, lexeme: string) => `jsonb_build_object(
  'language',${lexeme}.language_id,'lemma',${lexeme}.lemma,'pos',${lexeme}.pos,'reading',${lexeme}.reading,
  'lexeme_attributes',${lexeme}.attributes-'lexicon',
  'definition',${sense}.definition,'definition_language',${sense}.definition_language_id,
  'register',${sense}.register,'domain',${sense}.domain,
  'sense_attributes',${sense}.attributes-ARRAY['lexicon','synset_id'],
  'tags',coalesce((SELECT jsonb_agg(tag_code ORDER BY tag_code) FROM core.sense_tag WHERE sense_id=${sense}.id),'[]'::jsonb),
  'restrictions',coalesce((SELECT jsonb_agg(jsonb_build_object('kind',f.kind,'text',f.form_text,'attributes',f.attributes) ORDER BY f.kind,f.form_text)
       FROM core.sense_form sf JOIN core.lexeme_form f ON f.id=sf.form_id WHERE sf.sense_id=${sense}.id),'[]'::jsonb),
  'gloss_content',coalesce((SELECT jsonb_agg(jsonb_build_object('language',lg.code,'rank',g.rank,'text',g.text,'detail',g.detail,'machine',g.is_machine,'reviewed_by',g.reviewed_by::text,'reviewed_at',g.reviewed_at,'quality',g.quality) ORDER BY lg.code,g.rank)
       FROM core.sense_gloss g JOIN public.language lg ON lg.id=g.language_id WHERE g.sense_id=${sense}.id),'[]'::jsonb)
)`;

function quote(name: string): string {
  return '"' + name.replaceAll('"', '""') + '"';
}

export async function inventoryDuplicates(
  client: Client,
  target: string,
  limit = 500,
  afterSenseId = '0',
  afterPeerSenseId = '0',
) {
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 5000 ||
    !/^\d+$/.test(afterSenseId) ||
    !/^\d+$/.test(afterPeerSenseId)
  )
    throw new Error('Invalid inventory bounds');
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await client.query("SET LOCAL statement_timeout='60s'");
    await client.query("SET LOCAL work_mem='16MB'");
    await client.query('SET LOCAL max_parallel_workers_per_gather=0');
    const snap = await client.query<{ snapshot: string }>(
      'SELECT pg_current_snapshot()::text AS snapshot',
    );
    const pairs = await client.query<Pair>(
      `
      SELECT a.id::text AS keep_sense_id,b.id::text AS other_sense_id,
             la.id::text AS keep_lexeme_id,lb.id::text AS other_lexeme_id,ca.concept_id::text,
             ${scope('a', 'la')} AS keep_scope,${scope('b', 'lb')} AS other_scope,
             jsonb_build_object('source',sa.code,'version',sa.version,'lexeme_external_id',la.external_id,'sense_external_id',a.external_id,'attributes',a.attributes,'batch_id',a.batch_id) AS keep_source,
             jsonb_build_object('source',sb.code,'version',sb.version,'lexeme_external_id',lb.external_id,'sense_external_id',b.external_id,'attributes',b.attributes,'batch_id',b.batch_id) AS other_source
      FROM core.sense_concept ca JOIN core.sense a ON a.id=ca.sense_id
      JOIN core.lexeme la ON la.id=a.lexeme_id JOIN public.source sa ON sa.id=a.source_id AND sa.code='oewn'
      JOIN core.sense_concept cb ON cb.concept_id=ca.concept_id AND cb.sense_id<>ca.sense_id
      JOIN core.sense b ON b.id=cb.sense_id JOIN core.lexeme lb ON lb.id=b.lexeme_id
      JOIN public.source sb ON sb.id=b.source_id AND sb.code='omw-en'
      JOIN core.wordnet_synset wa ON wa.lexicon=a.attributes->>'lexicon' AND wa.synset_id=a.attributes->>'synset_id'
        AND wa.concept_id=ca.concept_id AND wa.source_id=a.source_id
      JOIN core.wordnet_synset wb ON wb.lexicon=b.attributes->>'lexicon' AND wb.synset_id=b.attributes->>'synset_id'
        AND wb.concept_id=cb.concept_id AND wb.source_id=b.source_id
      WHERE ca.verified AND cb.verified AND ca.relation='exact' AND cb.relation='exact'
        AND ca.method='wordnet_synset' AND cb.method='wordnet_synset'
        AND la.language_id=1 AND lb.language_id=1 AND la.lemma=lb.lemma
        AND la.pos IS NOT DISTINCT FROM lb.pos AND la.reading IS NOT DISTINCT FROM lb.reading
        AND nullif(btrim(a.definition),'') IS NOT NULL AND a.definition=b.definition
        AND (a.id,b.id)>($1::bigint,$2::bigint) ORDER BY a.id,b.id LIMIT $3`,
      [afterSenseId, afterPeerSenseId, limit + 1],
    );
    const rows = pairs.rows.slice(0, limit);
    const fk = await client.query<ForeignKey>(`
      SELECT n.nspname AS schema,c.relname AS table,a.attname AS column,
        con.confrelid::regclass::text AS referenced,con.conname AS name,
        cardinality(con.conkey)=1 AND cardinality(con.confkey)=1 AS supported
      FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=con.conkey[1]
      WHERE con.contype='f' AND con.confrelid IN ('core.sense'::regclass,'core.lexeme'::regclass)
      ORDER BY con.confrelid,n.nspname,c.relname,con.conname`);
    const senseIds = [
      ...new Set(rows.flatMap((r) => [r.keep_sense_id, r.other_sense_id])),
    ];
    const lexemeIds = [
      ...new Set(rows.flatMap((r) => [r.keep_lexeme_id, r.other_lexeme_id])),
    ];
    const dependencies: Record<string, Record<string, number>> = {};
    for (const f of fk.rows.filter((f) => f.supported)) {
      const ids = f.referenced === 'core.sense' ? senseIds : lexemeIds;
      const counts = await client.query<{ id: string; n: string }>(
        `SELECT ${quote(f.column)}::text AS id,count(*)::text AS n FROM ${quote(f.schema)}.${quote(f.table)} WHERE ${quote(f.column)}=ANY($1::bigint[]) GROUP BY ${quote(f.column)}`,
        [ids],
      );
      const key = f.schema + '.' + f.table + '.' + f.column;
      dependencies[key] = Object.fromEntries(
        counts.rows.map((r) => [r.id, Number(r.n)]),
      );
    }
    const records = rows.map((r) => {
      const keepHash = hash(r.keep_scope),
        otherHash = hash(r.other_scope);
      const refs = Object.fromEntries(
        fk.rows
          .filter((f) => f.supported)
          .map((f) => {
            const key = f.schema + '.' + f.table + '.' + f.column;
            return [
              key,
              dependencies[key][
                f.referenced === 'core.sense'
                  ? r.other_sense_id
                  : r.other_lexeme_id
              ] ?? 0,
            ];
          }),
      );
      return {
        ...r,
        keepScopeHash: keepHash,
        otherScopeHash: otherHash,
        classification:
          keepHash === otherHash ? 'same_scope_candidate' : 'context_conflict',
        otherReferences: refs,
        directlyDeletable: false,
        blockers: [
          'source_identity_alias_and_importer_resolution_required',
          ...(Object.values(refs).some((n) => n > 0)
            ? ['dependent_rows_require_preservation_or_repoint']
            : []),
          ...(keepHash !== otherHash ? ['semantic_context_differs'] : []),
          ...(fk.rows.some((f) => !f.supported)
            ? ['unsupported_fk_requires_manual_inventory']
            : []),
        ],
      };
    });
    const body = {
      schema: 'dictionary-duplicate-inventory-v1',
      target,
      observedAt: new Date().toISOString(),
      snapshot: snap.rows[0].snapshot,
      policy: 'wordnet-exact-anchor-full-scope-v1',
      scopeNotes: [
        'Only OEWN versus OMW-EN source-backed verified exact anchors.',
        'Only known provenance keys lexicon/synset_id are excluded from scope; retained separately.',
        'Same definition/concept with differing full payload is a conflict. No inferred equivalence for JA unknown reading.',
        'Foreign-key counts contain no user row IDs or content. Zero FK does not prove zero external/artifact references.',
        'Candidate equivalence is not a deletion approval. No IDs deleted or repointed.',
      ],
      truncated: pairs.rows.length > limit,
      nextAfterSenseId: rows.at(-1)?.keep_sense_id ?? afterSenseId,
      nextAfterPeerSenseId: rows.at(-1)?.other_sense_id ?? afterPeerSenseId,
      foreignKeys: fk.rows,
      records,
      counts: {
        pairs: records.length,
        sameScopeCandidates: records.filter(
          (r) => r.classification === 'same_scope_candidate',
        ).length,
        contextConflicts: records.filter(
          (r) => r.classification === 'context_conflict',
        ).length,
        pairsWithAppReferences: records.filter((r) =>
          Object.entries(r.otherReferences).some(
            ([k, n]) => k.startsWith('app.') && n > 0,
          ),
        ).length,
        directlyDeletable: 0,
      },
    };
    await client.query('COMMIT');
    return { ...body, digest: hash(body) };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

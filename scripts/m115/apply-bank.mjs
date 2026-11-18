/**
 * M11.5: Idempotent SQL apply of approved_bank.jsonl into app.quiz_question_bank.
 * Never overwrites human_reviewed or quarantined rows.
 */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

export function buildUpsertSql() {
  return `
    INSERT INTO app.quiz_question_bank (
      sense_id,
      language_id,
      skill,
      variant_no,
      rubric_version,
      sentence_before,
      target_surface,
      sentence_after,
      sentence_hash,
      canonical_answer,
      fixed_distractors,
      pos_bucket,
      excluded_words,
      origin,
      verification,
      generator_model,
      validator_model,
      status,
      updated_at
    )
    SELECT
      $1::bigint,
      $2::smallint,
      $3::text,
      $4::smallint,
      $5::text,
      $6::text,
      $7::text,
      $8::text,
      $9::text,
      $10::text,
      $11::jsonb,
      $12::text,
      $13::jsonb,
      'generated',
      'machine_reviewed',
      $14::text,
      $15::text,
      'active',
      now()
    WHERE EXISTS (SELECT 1 FROM core.sense WHERE id = $1::bigint)
      AND (
        $3::text <> 'kanji_reading'
        OR NOT EXISTS (
          SELECT 1
          FROM core.lexeme_form hk
          JOIN core.lexeme_form_applies_to ha ON ha.target_form_id = hk.id
          JOIN core.lexeme_form hr ON hr.id = ha.form_id AND hr.kind = 'kana'
          WHERE hk.kind = 'kanji'
            AND hk.form_text = $7::text
            AND $11::jsonb ? hr.form_text
        )
      )
    ON CONFLICT (sense_id, skill, rubric_version, variant_no)
    DO UPDATE SET
      sentence_before = EXCLUDED.sentence_before,
      target_surface = EXCLUDED.target_surface,
      sentence_after = EXCLUDED.sentence_after,
      sentence_hash = EXCLUDED.sentence_hash,
      canonical_answer = EXCLUDED.canonical_answer,
      fixed_distractors = EXCLUDED.fixed_distractors,
      pos_bucket = EXCLUDED.pos_bucket,
      excluded_words = EXCLUDED.excluded_words,
      generator_model = EXCLUDED.generator_model,
      validator_model = EXCLUDED.validator_model,
      updated_at = now()
    WHERE app.quiz_question_bank.verification <> 'human_reviewed'
      AND app.quiz_question_bank.status <> 'quarantined'
  `;
}

export async function applyApprovedBank({ outDir, databaseUrl }) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required for applyApprovedBank');
  const rows = (await readFile(join(outDir, 'approved_bank.jsonl'), 'utf8'))
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const sql = buildUpsertSql();
  let applied = 0;
  try {
    for (let i = 0; i < rows.length; i += 200) {
      const slice = rows.slice(i, i + 200);
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '5s'");
      for (const r of slice) {
        const res = await client.query(sql, [
          String(r.senseId),
          Number(r.languageId),
          String(r.skill),
          Number(r.variantNo),
          String(r.rubricVersion ?? 'm11.5-v1'),
          String(r.sentenceBefore),
          String(r.targetSurface),
          String(r.sentenceAfter),
          String(r.sentenceHash),
          String(r.canonicalAnswer),
          JSON.stringify(r.fixedDistractors ?? []),
          r.posBucket ?? null,
          JSON.stringify(r.excludedWords ?? []),
          r.generatorModel ?? null,
          r.validatorModel ?? 'muse-ai',
        ]);
        applied += res.rowCount ?? 0;
      }
      await client.query('COMMIT');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end().catch(() => {});
  }
  return { totalRows: rows.length, applied };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const outDir = process.argv[2] ? resolve(process.argv[2]) : resolve('uploads/m11.5-deck-bank');
  const res = await applyApprovedBank({
    outDir,
    databaseUrl: process.env.DATABASE_URL,
  });
  console.log(JSON.stringify(res));
}

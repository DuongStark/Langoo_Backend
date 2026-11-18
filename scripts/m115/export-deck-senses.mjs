/**
 * M11.5: Read-only export of unique sense_ids across all published core.deck (EN + JA).
 * Runs SQL on langoo-vps via SSH (never copies DB credentials to local disk or stdout).
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256 } from './core-gate.mjs';

const REMOTE_EXPORT_PY = `
import os, json, subprocess

env_path = "/opt/langoo/app/.env"
db_url = None
for line in open(env_path, encoding="utf-8"):
    line = line.strip()
    if line.startswith("DATABASE_URL="):
        db_url = line.split("=", 1)[1].strip().strip('"').strip("'")
        break
if not db_url:
    raise RuntimeError("DATABASE_URL not found on VPS")

sql = r"""
  WITH deck_senses AS (
    SELECT di.anchor_sense_id AS sense_id,
           ARRAY_AGG(DISTINCT d.slug ORDER BY d.slug) AS decks
    FROM core.deck d
    JOIN core.deck_item di ON di.deck_id = d.id
    WHERE d.is_published = true AND d.language_id IN (1, 2)
    GROUP BY di.anchor_sense_id
  ),
  kanji_pairs AS (
    SELECT s.id AS sense_id,
           jsonb_agg(
             jsonb_build_object(
               'written', k.form_text,
               'reading', r.form_text,
               'eligible', (
                 EXISTS(SELECT 1 FROM core.sense_form sf WHERE sf.sense_id=s.id AND sf.form_id=k.id)
                 AND EXISTS(SELECT 1 FROM core.sense_form sf WHERE sf.sense_id=s.id AND sf.form_id=r.id)
                 AND NOT EXISTS(SELECT 1 FROM core.lexeme_form_tag t WHERE t.form_id IN (k.id,r.id)
                   AND t.tag_code IN ('sK','sk','iK','ik','io','oK','ok','rK','rk','ateji'))
               )
             ) ORDER BY k.form_order, r.form_order
           ) AS pairs
    FROM deck_senses ds
    JOIN core.sense s ON s.id = ds.sense_id
    JOIN core.lexeme x ON x.id = s.lexeme_id AND x.language_id = 2
    JOIN core.lexeme_form k ON k.lexeme_id = x.id AND k.kind = 'kanji'
    JOIN core.lexeme_form r ON r.lexeme_id = x.id AND r.kind = 'kana'
    JOIN core.lexeme_form_applies_to a ON a.form_id = r.id AND a.target_form_id = k.id
    GROUP BY s.id
  )
  SELECT json_build_object(
    'senseId', s.id::text,
    'lexemeId', x.id::text,
    'languageId', x.language_id,
    'languageCode', lg.code,
    'lemma', x.lemma,
    'reading', x.reading,
    'pos', x.pos,
    'attributes', CASE
      WHEN x.language_id = 2 THEN jsonb_build_object(
        'pos_tags', COALESCE(s.attributes->'pos', s.attributes->'tags', x.attributes->'pos', '[]'::jsonb)
      )
      ELSE '{}'::jsonb
    END,
    'definition', left(COALESCE(s.definition, ''), 300),
    'glosses', COALESCE(
      (SELECT jsonb_agg(g.text ORDER BY g.language_id, g.rank, g.id)
       FROM core.sense_gloss g
       WHERE g.sense_id = s.id AND g.language_id IN (1, 3)),
      '[]'::jsonb
    ),
    'decks', ds.decks,
    'kanjiPairs', COALESCE(kp.pairs, '[]'::jsonb)
  )::text
  FROM deck_senses ds
  JOIN core.sense s ON s.id = ds.sense_id
  JOIN core.lexeme x ON x.id = s.lexeme_id
  JOIN public.language lg ON lg.id = x.language_id
  LEFT JOIN kanji_pairs kp ON kp.sense_id = s.id
  ORDER BY x.language_id, s.id;
"""

proc = subprocess.run(
    ["psql", db_url, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", "BEGIN READ ONLY; " + sql + " COMMIT;"],
    capture_output=True, text=True, check=True
)
for line in proc.stdout.splitlines():
    s = line.strip()
    if s.startswith("{"):
        json.loads(s)
        print(s)
`;

export async function exportDeckSenses({
  outDir = resolve('uploads/m11.5-deck-bank'),
  sshTarget = 'langoo-vps',
} = {}) {
  await mkdir(outDir, { recursive: true, mode: 0o700 });
  const stdout = await new Promise((resolveOut, rejectOut) => {
    const child = spawn('ssh', ['-o', 'BatchMode=yes', sshTarget, 'python3', '-'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const chunks = [];
    const errChunks = [];
    child.stdout.on('data', (c) => chunks.push(c));
    child.stderr.on('data', (c) => errChunks.push(c));
    child.on('error', rejectOut);
    child.on('close', (code) => {
      if (code !== 0) {
        rejectOut(
          new Error(
            `SSH export failed (${code}): ${Buffer.concat(errChunks).toString('utf8').slice(0, 400)}`,
          ),
        );
      } else {
        resolveOut(Buffer.concat(chunks).toString('utf8'));
      }
    });
    child.stdin.end(REMOTE_EXPORT_PY);
  });

  const lines = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const parsed = lines.map((line) => JSON.parse(line));
  const jsonl = parsed.map((row) => JSON.stringify(row)).join('\n') + '\n';
  const sensesPath = join(outDir, 'source_senses.jsonl');
  await writeFile(sensesPath, jsonl, { mode: 0o600 });

  const enCount = parsed.filter((r) => r.languageCode === 'en').length;
  const jaCount = parsed.filter((r) => r.languageCode === 'ja').length;
  const manifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    totalSenses: parsed.length,
    enSenses: enCount,
    jaSenses: jaCount,
    sha256: sha256(jsonl),
  };
  await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {
    mode: 0o600,
  });
  return manifest;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const outDir = process.argv[2] ? resolve(process.argv[2]) : resolve('uploads/m11.5-deck-bank');
  const manifest = await exportDeckSenses({ outDir });
  console.log(JSON.stringify(manifest));
}

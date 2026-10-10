/** M4.5: render separately authored semantic annotations; never alter AI output. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hash } from './learner-priority-muse.mjs';
const directory = resolve(process.argv[2]);
const input = JSON.parse(readFileSync(`${directory}/input.json`, 'utf8'));
const results = JSON.parse(readFileSync(`${directory}/results.json`, 'utf8'));
const annotations = JSON.parse(
  readFileSync(`${directory}/semantic-review.json`, 'utf8'),
);
if (annotations.source_identity !== results.identity)
  throw new Error('Review source drift');
if (
  new Set(annotations.records.map((r) => r.lemma)).size !==
  annotations.records.length
)
  throw new Error('Duplicate annotation');
for (const annotation of annotations.records) {
  const word = results.records.find((r) => r.lemma === annotation.lemma);
  if (
    !word?.output ||
    !word.complete_context_processed ||
    hash(word.output) !== annotation.output_hash
  )
    throw new Error('Review/output drift');
  if (
    !['pass', 'minor', 'severe'].includes(annotation.verdict) ||
    !['improved', 'similar', 'regressed'].includes(annotation.comparison) ||
    !annotation.note?.trim() ||
    !annotation.learner_vi?.trim()
  )
    throw new Error('Invalid semantic annotation');
  if (annotation.proposed_sense_ids) {
    const ids = annotation.proposed_sense_ids;
    const source = input.records.find((r) => r.lemma === annotation.lemma);
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 3 ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !source.senses.some((s) => s.senseId === id))
    )
      throw new Error('Foreign/duplicate proposal sense');
  }
}
const summary = {
  task: 'M4.5',
  generated: results.generated,
  reviewed: annotations.records.length,
  pass: annotations.records.filter((r) => r.verdict === 'pass').length,
  minor: annotations.records.filter((r) => r.verdict === 'minor').length,
  severe: annotations.records.filter((r) => r.verdict === 'severe').length,
  comparison: Object.fromEntries(
    ['improved', 'similar', 'regressed'].map((v) => [
      v,
      annotations.records.filter((r) => r.comparison === v).length,
    ]),
  ),
  reviewer: annotations.reviewer,
  human_review: false,
  frequency_measured: false,
  gate_50: false,
  db_mutations: 0,
};
summary.gate_50 =
  summary.generated === 50 &&
  summary.reviewed === 50 &&
  summary.pass >= 45 &&
  summary.severe === 0;
const e = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
const articles = results.records
  .map((word) => {
    const source = input.records.find((r) => r.lemma === word.lemma),
      review = annotations.records.find((r) => r.lemma === word.lemma);
    const baseline = source.senses.find((s) => s.senseId === source.baseline);
    const proposal =
      review?.proposed_sense_ids?.map((id) =>
        source.senses.find((s) => s.senseId === id),
      ) ?? [];
    return `<article><h2>${e(word.lemma)} <small>${e(review?.verdict ?? 'chờ review')}</small></h2><p class="vi">Reviewer: ${e(review?.learner_vi ?? '')}</p><h3>Muse đã chọn</h3><ol>${word.selected.map((s) => `<li>${e(s.definition)}<small>${e(s.pos)} · ${e(s.source)} · ID ${e(s.senseId)}</small>${s.rawDefinition !== s.definition ? `<details><summary>Scope nguồn</summary>${e(s.rawDefinition)}<p>${e(s.glossEnContext.join(' / '))}</p></details>` : ''}</li>`).join('')}</ol>${proposal.length ? `<h3>GPT đề xuất (chưa apply)</h3><ol>${proposal.map((s) => `<li>${e(s.definition)}<small>${e(s.pos)} · ${e(s.source)} · ID ${e(s.senseId)}</small></li>`).join('')}</ol>` : ''}<p>${e(review?.note ?? 'Chưa chấm ngữ nghĩa.')}</p><details><summary>So baseline / căn cứ AI</summary><p>Baseline: ${e(baseline.definition)}</p><p>So sánh: ${e(review?.comparison)}</p><p>${e(word.output?.reason)}</p><p>Inventory: ${word.source_sense_count}; full context: ${word.complete_context_processed}; AI needs_review: ${word.output?.needs_review}; part uncertainty: ${word.part_needs_review}</p></details></article>`;
  })
  .join('\n');
writeFileSync(
  `${directory}/review-summary.json`,
  JSON.stringify(summary, null, 2),
  { mode: 0o600 },
);
writeFileSync(
  `${directory}/review.html`,
  `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>M4.5 — Muse 50 từ</title><style>body{font:16px/1.6 system-ui;max-width:1100px;margin:auto;padding:24px;color:#172b4d;background:#f5f8fc}header,article{background:white;border:1px solid #dce4ef;border-radius:12px;padding:20px;margin:16px 0}small{display:block;color:#586b85;font-size:13px}h2 small{display:inline;margin-left:12px}li{margin:10px 0}.vi{font-weight:600;color:#1e5b9b}summary{cursor:pointer}details{margin:8px 0}input{padding:10px;width:90%;font:inherit}</style><header><h1>M4.5 — Muse chọn nghĩa cho 50 từ</h1><p>Đã sinh ${summary.generated}/50; đã chấm ${summary.reviewed}/50; phù hợp ${summary.pass}, minor ${summary.minor}, severe ${summary.severe}. Gate: ${summary.gate_50 ? 'đạt pilot 50' : 'chưa đạt / chưa đủ review'}.</p><p>Review bởi GPT; không phải tần suất đo từ corpus. Chưa áp dụng ranking vào DB. Dòng tiếng Việt là nhãn giải thích của reviewer, không phải gloss dịch đã seed.</p><input id="search" placeholder="Lọc từ…" aria-label="Lọc từ"></header>${articles}<script>document.getElementById('search').addEventListener('input',e=>{const q=e.target.value.trim().toLowerCase();document.querySelectorAll('article').forEach(a=>a.hidden=!a.querySelector('h2').textContent.toLowerCase().includes(q))})</script></html>`,
  { mode: 0o600 },
);
console.log(JSON.stringify(summary));

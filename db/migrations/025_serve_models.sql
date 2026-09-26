-- 023_serve_models.sql — read model tầng serve cho API tra cứu và học tập.
--
-- sense_pair là materialized view có CỔNG CHẤT LƯỢNG: chỉ concept
-- status='curated' và confidence >= 0.7 mới lọt ra — hiện toàn bộ concept còn
-- 'draft' nên view rỗng, đúng thiết kế (chế độ song ngữ tự ẩn).
-- Refresh ngoài transaction (CONCURRENTLY) bằng script/cron:
--   REFRESH MATERIALIZED VIEW CONCURRENTLY serve.sense_pair;

CREATE SCHEMA serve;

-- Cặp sense khác ngôn ngữ cùng một concept (nguồn cho gợi ý "thêm cả りんご?").
CREATE MATERIALIZED VIEW serve.sense_pair AS
SELECT
  sa.id                AS sense_a,
  la.language_id       AS lang_a,
  sb.id                AS sense_b,
  lb.language_id       AS lang_b,
  ca.concept_id,
  LEAST(ca.confidence, cb.confidence) AS confidence
FROM core.sense_concept ca
JOIN core.sense_concept cb
  ON cb.concept_id = ca.concept_id
 AND cb.sense_id <> ca.sense_id
JOIN core.concept c
  ON c.id = ca.concept_id
 AND c.status = 'curated'
JOIN core.sense sa ON sa.id = ca.sense_id
JOIN core.sense sb ON sb.id = cb.sense_id
JOIN core.lexeme la ON la.id = sa.lexeme_id
JOIN core.lexeme lb ON lb.id = sb.lexeme_id
WHERE la.language_id <> lb.language_id
  AND LEAST(ca.confidence, cb.confidence) >= 0.7;

CREATE UNIQUE INDEX sense_pair_pair ON serve.sense_pair (sense_a, sense_b);
CREATE INDEX sense_pair_lookup ON serve.sense_pair (sense_a, lang_b, confidence DESC);

-- Một dòng / một sense cho UI tra cứu: lexeme + nghĩa ưu tiên (người duyệt →
-- nguồn → máy) + badge chất lượng + concept.
CREATE VIEW serve.sense_card AS
SELECT
  se.id                        AS sense_id,
  se.lexeme_id,
  x.language_id,
  x.lemma,
  x.reading,
  x.romanization,
  x.pos,
  x.frequency_rank,
  x.homograph_no,
  se.sense_no,
  se.definition,
  se.definition_language_id,
  se.register,
  se.domain,
  se.is_primary,
  vi.text                      AS gloss_vi,
  vi.is_machine                AS gloss_vi_machine,
  (vi.reviewed_by IS NOT NULL) AS gloss_vi_reviewed,
  en.text                      AS gloss_en,
  sc.concept_id
FROM core.sense se
JOIN core.lexeme x ON x.id = se.lexeme_id
LEFT JOIN LATERAL (
  SELECT g.text, g.is_machine, g.reviewed_by
  FROM core.sense_gloss g
  JOIN public.language lg ON lg.id = g.language_id
  WHERE g.sense_id = se.id AND lg.code = 'vi'
  ORDER BY (g.reviewed_by IS NOT NULL) DESC, g.is_machine, g.rank
  LIMIT 1
) vi ON true
LEFT JOIN LATERAL (
  SELECT g.text
  FROM core.sense_gloss g
  JOIN public.language lg ON lg.id = g.language_id
  WHERE g.sense_id = se.id AND lg.code = 'en'
  ORDER BY (g.reviewed_by IS NOT NULL) DESC, g.is_machine, g.rank
  LIMIT 1
) en ON true
LEFT JOIN LATERAL (
  SELECT sc.concept_id
  FROM core.sense_concept sc
  JOIN core.concept c ON c.id = sc.concept_id
  WHERE sc.sense_id = se.id
  ORDER BY (c.status = 'curated') DESC, sc.confidence DESC
  LIMIT 1
) sc ON true;

-- Một dòng / một chữ Hán cho màn chi tiết chữ: số nét, cấp, âm, nghĩa,
-- bộ thủ (kèm nghĩa tiếng Việt khi đã seed public.radical) và mức dùng.
CREATE VIEW serve.kanji_card AS
SELECT
  k.literal,
  k.codepoint_ucs,
  k.grade,
  k.stroke_count,
  k.frequency_rank,
  k.jlpt_old,
  k.jlpt_new,
  k.radical_classical,
  r.character   AS radical_char,
  r.name_vi     AS radical_name_vi,
  r.meaning_vi  AS radical_meaning_vi,
  k.readings,
  k.meanings,
  k.nanori,
  k.query_codes,
  (SELECT count(*) FROM core.lexeme_form_kanji_char fc
    WHERE fc.kanji_literal = k.literal) AS used_in_forms,
  (SELECT array_agg(m.kind ORDER BY m.kind) FROM core.kanji_media m
    WHERE m.kanji_literal = k.literal) AS media_kinds
FROM core.kanji k
LEFT JOIN public.radical r ON r.number = k.radical_classical;

-- Một dòng / một "mặt chữ" tìm kiếm được (lemma hoặc form) cho API tra từ.
-- Tìm không dấu/giống âm cần pg_trgm + unaccent trên PostgreSQL production;
-- view này chỉ chuẩn hoá nguồn dữ liệu, không thay thế index.
CREATE VIEW serve.dictionary_search AS
SELECT x.id AS lexeme_id, x.language_id, l.code AS lang_code, x.lemma AS surface,
       x.reading, x.pos, x.frequency_rank, x.homograph_no, 'lemma'::text AS surface_kind
FROM core.lexeme x
JOIN public.language l ON l.id = x.language_id
UNION ALL
SELECT x.id, x.language_id, l.code, f.form_text, x.reading, x.pos,
       x.frequency_rank, x.homograph_no, f.kind
FROM core.lexeme_form f
JOIN core.lexeme x ON x.id = f.lexeme_id
JOIN public.language l ON l.id = x.language_id;

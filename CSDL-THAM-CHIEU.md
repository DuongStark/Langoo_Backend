> M6.3 — schema local sau migration051 (2026-11-18): đã bỏ recall, XP, level,
> leaderboard và huy hiệu; giữ streak/thống kê học. Chưa áp production.
> Prisma và migration là nguồn DDL chuẩn; số thứ tự cột snapshot có thể còn khoảng trống.

# CSDL tham chiếu — Langoo

> Sinh tự động bởi `scripts/dump_schema_doc.py` lúc **2026-10-05 08:21** · PostgreSQL 16.2.
> KHÔNG sửa tay — chạy lại script sau mỗi migration.

Tổng: **97 bảng** (chưa kể 36 partition) + **4 view/matview**.

## Mục lục

- **public** (5) — [`public.language`](#publiclanguage) · [`public.radical`](#publicradical) · [`public.schema_migration`](#publicschema_migration) · [`public.source`](#publicsource) · [`public.tag`](#publictag)
- **staging** (14) — [`staging.ili_map_pwn30`](#stagingili_map_pwn30) · [`staging.import_batch`](#stagingimport_batch) · [`staging.jlpt_entry`](#stagingjlpt_entry) · [`staging.jmdict_entry`](#stagingjmdict_entry) · [`staging.kanji_data_entry`](#stagingkanji_data_entry) · [`staging.kanji_entry`](#stagingkanji_entry) · [`staging.krad_entry`](#stagingkrad_entry) · [`staging.omw_wikt_vi`](#stagingomw_wikt_vi) · [`staging.tatoeba_link`](#stagingtatoeba_link) · [`staging.tatoeba_sentence`](#stagingtatoeba_sentence) · [`staging.wikt_entry`](#stagingwikt_entry) · [`staging.wn_example`](#stagingwn_example) · [`staging.wn_relation`](#stagingwn_relation) · [`staging.wn_synset`](#stagingwn_synset)
- **core** (42) — [`core.concept`](#coreconcept) · [`core.concept_media`](#coreconcept_media) · [`core.concept_gloss`](#coreconcept_gloss) · [`core.concept_gloss_history`](#coreconcept_gloss_history) · [`core.concept_label`](#coreconcept_label) · [`core.deck`](#coredeck) · [`core.deck_item`](#coredeck_item) · [`core.example`](#coreexample) · [`core.example_annotation`](#coreexample_annotation) · [`core.example_concept`](#coreexample_concept) · [`core.example_sense`](#coreexample_sense) · [`core.example_translation`](#coreexample_translation) · [`core.jlpt_link`](#corejlpt_link) · [`core.kanji`](#corekanji) · [`core.kanji_media`](#corekanji_media) · [`core.kanji_radical`](#corekanji_radical) · [`core.lexeme`](#corelexeme) · [`core.lexeme_form`](#corelexeme_form) · [`core.lexeme_form_applies_to`](#corelexeme_form_applies_to) · [`core.lexeme_form_char`](#corelexeme_form_char) · [`core.lexeme_form_kanji_char`](#corelexeme_form_kanji_char) · [`core.lexeme_form_tag`](#corelexeme_form_tag) · [`core.lexeme_level`](#corelexeme_level) · [`core.mapping_run`](#coremapping_run) · [`core.media_asset`](#coremedia_asset) · [`core.pronunciation`](#corepronunciation) · [`core.sense`](#coresense) · [`core.sense_concept`](#coresense_concept) · [`core.sense_concept_candidate`](#coresense_concept_candidate) · [`core.sense_concept_candidate_review`](#coresense_concept_candidate_review) · [`core.sense_form`](#coresense_form) · [`core.sense_gloss`](#coresense_gloss) · [`core.sense_gloss_history`](#coresense_gloss_history) · [`core.sense_relation`](#coresense_relation) · [`core.sense_relation_candidate`](#coresense_relation_candidate) · [`core.sense_tag`](#coresense_tag) · [`core.source_entry_identity`](#coresource_entry_identity) · [`core.source_form`](#coresource_form) · [`core.translation_assertion`](#coretranslation_assertion) · [`core.translation_target_candidate`](#coretranslation_target_candidate) · [`core.wordnet_relation`](#corewordnet_relation) · [`core.wordnet_synset`](#corewordnet_synset)
- **app** (32) — [`app.admin_audit_log`](#appadmin_audit_log) · [`app.ai_usage`](#appai_usage) · [`app.chat_message`](#appchat_message) · [`app.chat_session`](#appchat_session) · [`app.collection`](#appcollection) · [`app.collection_item`](#appcollection_item) · [`app.collection_item_face`](#appcollection_item_face) · [`app.collection_item_tag`](#appcollection_item_tag) · [`app.collection_share`](#appcollection_share) · [`app.device`](#appdevice) · [`app.feedback`](#appfeedback) · [`app.feedback_attachment`](#appfeedback_attachment) · [`app.gloss_report`](#appgloss_report) · [`app.google_oauth_challenge`](#appgoogle_oauth_challenge) · [`app.notification_log`](#appnotification_log) · [`app.quiz`](#appquiz) · [`app.quiz_question`](#appquiz_question) · [`app.reminder`](#appreminder) · [`app.review_log`](#appreview_log) (partition) · [`app.search_history`](#appsearch_history) · [`app.srs_review_receipt`](#appsrs_review_receipt) · [`app.srs_state`](#appsrs_state) · [`app.streak_day`](#appstreak_day) · [`app.study_profile`](#appstudy_profile) · [`app.study_session`](#appstudy_session) · [`app.study_session_item`](#appstudy_session_item) · [`app.tag`](#apptag) · [`app.user_identity`](#appuser_identity) · [`app.user_session`](#appuser_session) · [`app.user_settings`](#appuser_settings) · [`app.user_stats`](#appuser_stats) · [`app.users`](#appusers)
- **serve** (5) — [`serve.concept_image`](#serveconcept_image) (view) · [`serve.dictionary_search`](#servedictionary_search) (view) · [`serve.kanji_card`](#servekanji_card) (view) · [`serve.sense_card`](#servesense_card) (view) · [`serve.sense_pair`](#servesense_pair) (matview)

## Schema `public`

*Metadata dùng chung: ngôn ngữ, nguồn dữ liệu, ánh xạ tag, bộ thủ.*

<a id="publiclanguage"></a>
### `public.language`

*table — 4 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | smallint | không |  |  |
| 2 | `code` | text | không |  |  |
| 3 | `name_vi` | text | không |  |  |
| 4 | `script` | text | có |  |  |
| 5 | `is_target` | boolean | không | true |  |
| 6 | `is_support` | boolean | không | false |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Ràng buộc khác**:
- `language_code_key` (unique): UNIQUE (code)

<a id="publicradical"></a>
### `public.radical`

*table — 0 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `number` | smallint | không |  |  |
| 2 | `character` | text | không |  |  |
| 3 | `name_en` | text | có |  |  |
| 4 | `name_vi` | text | có |  |  |
| 5 | `meaning_vi` | text | có |  |  |
| 6 | `stroke_count` | smallint | có |  |  |
| 7 | `variants` | text[] | không | '{}'::text[] | Biến thể đồ họa của bộ (ví dụ 心 → 忄, 㣺) để join với kanji_radical.part. |

**Khoá chính**: `PRIMARY KEY (number)`

**Ràng buộc khác**:
- `radical_character_check` (check): CHECK ((char_length("character") = 1))
- `radical_number_check` (check): CHECK (((number >= 1) AND (number <= 214)))
- `radical_stroke_count_check` (check): CHECK ((stroke_count > 0))
- `radical_character_key` (unique): UNIQUE ("character")

<a id="publicschema_migration"></a>
### `public.schema_migration`

*table — 36 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `name` | text | không |  |  |
| 2 | `applied_at` | timestamp with time zone | có | now() |  |

**Khoá chính**: `PRIMARY KEY (name)`

<a id="publicsource"></a>
### `public.source`

*table — 16 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | integer | không |  |  |
| 2 | `code` | text | không |  |  |
| 3 | `name` | text | không |  |  |
| 4 | `license` | text | không |  |  |
| 5 | `attribution` | text | không |  |  |
| 6 | `url` | text | có |  |  |
| 7 | `version` | text | có |  |  |
| 8 | `sha256` | text | có |  |  |
| 9 | `imported_at` | timestamp with time zone | có |  |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Ràng buộc khác**:
- `source_code_key` (unique): UNIQUE (code)

<a id="publictag"></a>
### `public.tag`

*table — 266 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `code` | text | không |  |  |
| 2 | `kind` | text | không |  |  |
| 3 | `label` | text | không |  |  |
| 4 | `pos_norm` | text | có |  |  |
| 5 | `domain_vi` | text | có |  |  |

**Khoá chính**: `PRIMARY KEY (code)`

**Ràng buộc khác**:
- `tag_kind_check` (check): CHECK ((kind = ANY (ARRAY['pos'::text, 'misc'::text, 'field'::text, 'dialect'::text, 'kanji'::text, 'kana'::text])))
- `tag_pos_norm_valid` (check): CHECK ((((kind = 'pos'::text) AND (pos_norm IS NOT NULL) AND (pos_norm = ANY (ARRAY['noun'::text, 'verb'::text, 'adjective'::text, 'adverb'::text, 'pronoun'::text, 'determiner'::text, 'particle'::text, 'auxiliary'::text, 'conjunction'::text, 'interjection'::text, 'expression'::text, 'counter'::text, 'prefix'::text, 'suffix'::text, 'unknown'::text]))) OR ((kind <> 'pos'::text) AND (pos_norm IS NULL))))

**Chỉ mục**:
- `tag_kind`: CREATE INDEX tag_kind ON public.tag USING btree (kind)

## Schema `staging`

*Dump thô ánh xạ 1-1 với nguồn, giữ nguyên payload + id gốc.*

<a id="stagingili_map_pwn30"></a>
### `staging.ili_map_pwn30`

*table — 117,659 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `ili` | text | không |  |  |
| 2 | `pwn30_offset` | text | không |  |  |
| 3 | `batch_id` | uuid | không |  |  |

**Khoá chính**: `PRIMARY KEY (ili, pwn30_offset)`

**Khoá ngoại**:
- `ili_map_pwn30_batch_id_fkey`: FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id)

<a id="stagingimport_batch"></a>
### `staging.import_batch`

*table — 22 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | uuid | không | gen_random_uuid() |  |
| 2 | `source_code` | text | không |  |  |
| 3 | `file_name` | text | không |  |  |
| 4 | `sha256` | text | không |  |  |
| 5 | `row_count` | integer | có |  |  |
| 6 | `started_at` | timestamp with time zone | có | now() |  |
| 7 | `finished_at` | timestamp with time zone | có |  |  |
| 8 | `status` | text | có | 'running'::text |  |
| 9 | `error` | text | có |  |  |

**Khoá chính**: `PRIMARY KEY (id)`

<a id="stagingjlpt_entry"></a>
### `staging.jlpt_entry`

*table — 7,972 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 2 | `expression` | text | không |  |  |
| 3 | `reading` | text | có |  |  |
| 4 | `meaning` | text | có |  |  |
| 5 | `tags` | text | có |  |  |
| 6 | `row_number` | integer | không |  |  |
| 7 | `batch_id` | uuid | không |  |  |

**Khoá chính**: `PRIMARY KEY (level, row_number)`

**Khoá ngoại**:
- `jlpt_entry_batch_id_fkey`: FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id)

**Ràng buộc khác**:
- `jlpt_entry_level_check` (check): CHECK (((level >= 1) AND (level <= 5)))

**Chỉ mục**:
- `jlpt_entry_match`: CREATE INDEX jlpt_entry_match ON staging.jlpt_entry USING btree (expression, reading)

<a id="stagingjmdict_entry"></a>
### `staging.jmdict_entry`

*table — 218,794 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `ent_seq` | bigint | không |  |  |
| 2 | `payload` | jsonb | không |  |  |
| 3 | `batch_id` | uuid | không |  |  |

**Khoá chính**: `PRIMARY KEY (ent_seq)`

**Khoá ngoại**:
- `jmdict_entry_batch_id_fkey`: FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id)

**Chỉ mục**:
- `jmdict_entry_batch`: CREATE INDEX jmdict_entry_batch ON staging.jmdict_entry USING btree (batch_id)

<a id="stagingkanji_data_entry"></a>
### `staging.kanji_data_entry`

*table — 13,108 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `literal` | text | không |  |  |
| 2 | `payload` | jsonb | không |  |  |
| 3 | `batch_id` | uuid | không |  |  |

**Khoá chính**: `PRIMARY KEY (literal)`

**Khoá ngoại**:
- `kanji_data_entry_batch_id_fkey`: FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id)

<a id="stagingkanji_entry"></a>
### `staging.kanji_entry`

*table — 13,108 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `literal` | text | không |  |  |
| 2 | `payload` | jsonb | không |  |  |
| 3 | `batch_id` | uuid | không |  |  |

**Khoá chính**: `PRIMARY KEY (literal)`

**Khoá ngoại**:
- `kanji_entry_batch_id_fkey`: FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id)

<a id="stagingkrad_entry"></a>
### `staging.krad_entry`

*table — 12,156 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `literal` | text | không |  |  |
| 2 | `parts` | jsonb | không |  |  |
| 3 | `batch_id` | uuid | không |  |  |

**Khoá chính**: `PRIMARY KEY (literal)`

**Khoá ngoại**:
- `krad_entry_batch_id_fkey`: FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id)

<a id="stagingomw_wikt_vi"></a>
### `staging.omw_wikt_vi`

*table — 5,498 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `pwn30_offset` | text | không |  |  |
| 2 | `lemma` | text | không |  |  |
| 3 | `batch_id` | uuid | không |  |  |

**Khoá chính**: `PRIMARY KEY (pwn30_offset, lemma)`

**Khoá ngoại**:
- `omw_wikt_vi_batch_id_fkey`: FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id)

<a id="stagingtatoeba_link"></a>
### `staging.tatoeba_link`

*table — 872,814 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `sentence_id` | bigint | không |  |  |
| 2 | `translation_id` | bigint | không |  |  |
| 3 | `batch_id` | uuid | không |  |  |

**Khoá chính**: `PRIMARY KEY (sentence_id, translation_id)`

**Khoá ngoại**:
- `tatoeba_link_batch_id_fkey`: FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id)

**Chỉ mục**:
- `tatoeba_link_trans`: CREATE INDEX tatoeba_link_trans ON staging.tatoeba_link USING btree (translation_id)

<a id="stagingtatoeba_sentence"></a>
### `staging.tatoeba_sentence`

*table — 2,319,079 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | bigint | không |  |  |
| 2 | `lang` | text | không |  |  |
| 3 | `text` | text | không |  |  |
| 4 | `batch_id` | uuid | không |  |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `tatoeba_sentence_batch_id_fkey`: FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id)

**Chỉ mục**:
- `tatoeba_sentence_lang`: CREATE INDEX tatoeba_sentence_lang ON staging.tatoeba_sentence USING btree (lang)

<a id="stagingwikt_entry"></a>
### `staging.wikt_entry`

*table — 1,744,216 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | bigint | không | nextval('staging.wikt_entry_id_seq'::regclass) |  |
| 2 | `lang_code` | text | không |  |  |
| 3 | `word` | text | không |  |  |
| 4 | `pos` | text | có |  |  |
| 5 | `payload` | jsonb | không |  |  |
| 6 | `batch_id` | uuid | không |  |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `wikt_entry_batch_id_fkey`: FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id)

**Chỉ mục**:
- `wikt_entry_word`: CREATE INDEX wikt_entry_word ON staging.wikt_entry USING btree (lang_code, word, pos)

<a id="stagingwn_example"></a>
### `staging.wn_example`

*table — 127,251 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `lexicon` | text | không |  |  |
| 2 | `synset_id` | text | không |  |  |
| 3 | `example` | text | không |  |  |
| 4 | `language` | text | có |  |  |
| 5 | `batch_id` | uuid | không |  |  |
| 6 | `id` | bigint | không | identity | Surrogate PK (DB1) — WordNet không có khoá tự nhiên. |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `wn_example_batch_id_fkey`: FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id)

**Chỉ mục**:
- `wn_example_synset`: CREATE INDEX wn_example_synset ON staging.wn_example USING btree (lexicon, synset_id)

<a id="stagingwn_relation"></a>
### `staging.wn_relation`

*table — 582,498 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `lexicon` | text | không |  |  |
| 2 | `source_id` | text | không |  |  |
| 3 | `target_id` | text | không |  |  |
| 4 | `rel_type` | text | không |  |  |
| 5 | `batch_id` | uuid | không |  |  |
| 6 | `id` | bigint | không | identity | Surrogate PK (DB1) — WordNet không có khoá tự nhiên. |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `wn_relation_batch_id_fkey`: FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id)

**Chỉ mục**:
- `wn_relation_src`: CREATE INDEX wn_relation_src ON staging.wn_relation USING btree (lexicon, source_id)

<a id="stagingwn_synset"></a>
### `staging.wn_synset`

*table — 295,473 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `lexicon` | text | không |  |  |
| 2 | `synset_id` | text | không |  |  |
| 3 | `ili` | text | có |  |  |
| 4 | `pos` | text | có |  |  |
| 5 | `lexfile` | text | có |  |  |
| 6 | `definition` | jsonb | có | '[]'::jsonb |  |
| 7 | `members` | jsonb | có | '[]'::jsonb |  |
| 8 | `batch_id` | uuid | không |  |  |

**Khoá chính**: `PRIMARY KEY (lexicon, synset_id)`

**Khoá ngoại**:
- `wn_synset_batch_id_fkey`: FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id)

**Chỉ mục**:
- `wn_synset_ili`: CREATE INDEX wn_synset_ili ON staging.wn_synset USING btree (ili)

## Schema `core`

*Từ điển chuẩn hoá: lexeme/sense/concept, kanji, ví dụ, mapping run/candidate.*

<a id="coreconcept"></a>
### `core.concept`

*table — 120,875 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | bigint | không | identity |  |
| 2 | `ili` | text | có |  |  |
| 3 | `pos` | text | có |  |  |
| 4 | `gloss_en` | text | có |  |  |
| 5 | `gloss_vi` | text | có |  |  |
| 6 | `cefr` | text | có |  |  |
| 7 | `status` | text | không | 'draft'::text | draft → review → curated/rejected; chỉ curated + confidence ≥ 0.7 vào serve.sense_pair. |
| 8 | `source_id` | integer | có |  |  |
| 9 | `batch_id` | uuid | có |  |  |
| 10 | `reviewed_by` | bigint | có |  | ID curator (tham chiếu logic app.users.id, không FK do bất biến core→app). |
| 11 | `reviewed_at` | timestamp with time zone | có |  | Thời điểm duyệt concept; luôn đi cặp với reviewed_by. |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `concept_batch_id_fkey`: FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id)
- `concept_source_id_fkey`: FOREIGN KEY (source_id) REFERENCES source(id)

**Ràng buộc khác**:
- `concept_ili_check` (check): CHECK (((ili IS NULL) OR (btrim(ili) <> ''::text)))
- `concept_pos_check` (check): CHECK ((pos = ANY (ARRAY['noun'::text, 'verb'::text, 'adjective'::text, 'adverb'::text, 'pronoun'::text, 'determiner'::text, 'particle'::text, 'auxiliary'::text, 'conjunction'::text, 'interjection'::text, 'expression'::text, 'counter'::text, 'prefix'::text, 'suffix'::text, 'unknown'::text])))
- `concept_review_pair` (check): CHECK (((reviewed_by IS NULL) = (reviewed_at IS NULL)))
- `concept_status_check` (check): CHECK ((status = ANY (ARRAY['draft'::text, 'review'::text, 'curated'::text, 'rejected'::text])))
- `concept_ili_key` (unique): UNIQUE (ili)

**Chỉ mục**:
- `concept_curated`: CREATE INDEX concept_curated ON core.concept USING btree (id) WHERE (status = 'curated'::text)

<a id="coreconcept_gloss"></a>
### `core.concept_gloss`

*table — 196,901 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `concept_id` | bigint | không |  |  |
| 2 | `language_id` | smallint | không |  |  |
| 3 | `rank` | smallint | không | 1 |  |
| 4 | `text` | text | không |  |  |
| 5 | `is_machine` | boolean | không | false |  |
| 6 | `quality` | smallint | có |  |  |
| 7 | `reviewed_by` | bigint | có |  |  |
| 8 | `reviewed_at` | timestamp with time zone | có |  |  |
| 9 | `source_id` | integer | có |  |  |
| 10 | `batch_id` | uuid | có |  |  |

**Khoá chính**: `PRIMARY KEY (concept_id, language_id, rank)`

**Khoá ngoại**:
- `concept_gloss_batch_id_fkey`: FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id)
- `concept_gloss_concept_id_fkey`: FOREIGN KEY (concept_id) REFERENCES core.concept(id) ON DELETE RESTRICT
- `concept_gloss_language_id_fkey`: FOREIGN KEY (language_id) REFERENCES language(id)
- `concept_gloss_source_id_fkey`: FOREIGN KEY (source_id) REFERENCES source(id)

**Ràng buộc khác**:
- `concept_gloss_quality_check` (check): CHECK (((quality >= 0) AND (quality <= 100)))
- `concept_gloss_rank_check` (check): CHECK ((rank > 0))
- `concept_gloss_review_pair` (check): CHECK (((reviewed_by IS NULL) = (reviewed_at IS NULL)))
- `concept_gloss_text_check` (check): CHECK ((btrim(text) <> ''::text))

<a id="coreconcept_gloss_history"></a>
### `core.concept_gloss_history`

*table — 0 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | bigint | không | identity |  |
| 2 | `concept_id` | bigint | không |  |  |
| 3 | `language_id` | smallint | không |  |  |
| 4 | `rank` | smallint | không |  |  |
| 5 | `event` | text | không |  |  |
| 6 | `old_data` | jsonb | không |  |  |
| 7 | `new_data` | jsonb | có |  |  |
| 8 | `changed_at` | timestamp with time zone | không | now() |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Ràng buộc khác**:
- `concept_gloss_history_event_check` (check): CHECK ((event = ANY (ARRAY['update'::text, 'delete'::text])))
- `concept_gloss_history_shape` (check): CHECK ((((event = 'update'::text) AND (new_data IS NOT NULL)) OR ((event = 'delete'::text) AND (new_data IS NULL))))

**Chỉ mục**:
- `concept_gloss_history_by_gloss`: CREATE INDEX concept_gloss_history_by_gloss ON core.concept_gloss_history USING btree (concept_id, language_id, rank, changed_at DESC)

<a id="coreconcept_label"></a>
### `core.concept_label`

*table — 5,368 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | bigint | không | identity |  |
| 2 | `concept_id` | bigint | không |  |  |
| 3 | `language_id` | smallint | không |  |  |
| 4 | `rank` | smallint | không | 1 |  |
| 5 | `text` | text | không |  |  |
| 6 | `label_kind` | text | không | 'lemma'::text |  |
| 7 | `is_machine` | boolean | không | false |  |
| 8 | `quality` | smallint | có |  |  |
| 9 | `source_id` | integer | có |  |  |
| 10 | `batch_id` | uuid | có |  |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `concept_label_batch_id_fkey`: FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id)
- `concept_label_concept_id_fkey`: FOREIGN KEY (concept_id) REFERENCES core.concept(id) ON DELETE RESTRICT
- `concept_label_language_id_fkey`: FOREIGN KEY (language_id) REFERENCES language(id)
- `concept_label_source_id_fkey`: FOREIGN KEY (source_id) REFERENCES source(id)

**Ràng buộc khác**:
- `concept_label_label_kind_check` (check): CHECK ((label_kind = ANY (ARRAY['lemma'::text, 'synonym'::text, 'definition'::text, 'translation'::text])))
- `concept_label_quality_check` (check): CHECK (((quality >= 0) AND (quality <= 100)))
- `concept_label_rank_check` (check): CHECK ((rank > 0))
- `concept_label_text_check` (check): CHECK ((btrim(text) <> ''::text))
- `concept_label_concept_id_language_id_rank_label_kind_key` (unique): UNIQUE (concept_id, language_id, rank, label_kind)

**Chỉ mục**:
- `concept_label_concept`: CREATE INDEX concept_label_concept ON core.concept_label USING btree (concept_id, language_id, rank)
- `concept_label_lookup`: CREATE INDEX concept_label_lookup ON core.concept_label USING btree (language_id, text)

<a id="coredeck"></a>
### `core.deck`

*table — 0 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | bigint | không | identity |  |
| 2 | `slug` | text | không |  |  |
| 3 | `title` | text | không |  |  |
| 4 | `description` | text | có |  |  |
| 5 | `language_id` | smallint | không |  |  |
| 6 | `level_label` | text | có |  |  |
| 7 | `is_published` | boolean | không | false |  |
| 8 | `item_count` | integer | không | 0 |  |
| 9 | `created_at` | timestamp with time zone | không | now() |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `deck_language_id_fkey`: FOREIGN KEY (language_id) REFERENCES language(id)

**Ràng buộc khác**:
- `deck_item_count_check` (check): CHECK ((item_count >= 0))
- `deck_slug_check` (check): CHECK ((btrim(slug) <> ''::text))
- `deck_title_check` (check): CHECK ((btrim(title) <> ''::text))
- `deck_slug_key` (unique): UNIQUE (slug)

**Chỉ mục**:
- `deck_published`: CREATE INDEX deck_published ON core.deck USING btree (language_id, level_label) WHERE is_published

<a id="coredeck_item"></a>
### `core.deck_item`

*table — 0 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `deck_id` | bigint | không |  |  |
| 2 | `anchor_sense_id` | bigint | không |  |  |
| 3 | `concept_id` | bigint | có |  |  |
| 4 | `position` | integer | không |  |  |

**Khoá chính**: `PRIMARY KEY (deck_id, anchor_sense_id)`

**Khoá ngoại**:
- `deck_item_anchor_sense_id_fkey`: FOREIGN KEY (anchor_sense_id) REFERENCES core.sense(id) ON DELETE RESTRICT
- `deck_item_concept_id_fkey`: FOREIGN KEY (concept_id) REFERENCES core.concept(id) ON DELETE RESTRICT
- `deck_item_deck_id_fkey`: FOREIGN KEY (deck_id) REFERENCES core.deck(id) ON DELETE CASCADE

**Ràng buộc khác**:
- `deck_item_position_check` (check): CHECK (("position" > 0))

**Chỉ mục**:
- `deck_item_concept`: CREATE INDEX deck_item_concept ON core.deck_item USING btree (concept_id) WHERE (concept_id IS NOT NULL)
- `deck_item_position`: CREATE INDEX deck_item_position ON core.deck_item USING btree (deck_id, "position")

<a id="coreexample"></a>
### `core.example`

*table — 3,512,695 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | bigint | không | identity |  |
| 2 | `sense_id` | bigint | có |  |  |
| 3 | `language_id` | smallint | không |  |  |
| 4 | `text` | text | không |  |  |
| 5 | `translation` | jsonb | không | '{}'::jsonb |  |
| 6 | `external_id` | text | có |  |  |
| 7 | `difficulty` | smallint | có |  |  |
| 8 | `source_id` | integer | có |  |  |
| 9 | `batch_id` | uuid | có |  |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `example_batch_id_fkey`: FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id)
- `example_language_id_fkey`: FOREIGN KEY (language_id) REFERENCES language(id)
- `example_sense_id_fkey`: FOREIGN KEY (sense_id) REFERENCES core.sense(id) ON DELETE RESTRICT
- `example_source_id_fkey`: FOREIGN KEY (source_id) REFERENCES source(id)

**Ràng buộc khác**:
- `example_difficulty_check` (check): CHECK ((difficulty >= 0))
- `example_external_id_check` (check): CHECK (((external_id IS NULL) OR (btrim(external_id) <> ''::text)))
- `example_external_source` (check): CHECK (((external_id IS NULL) OR (source_id IS NOT NULL)))
- `example_text_check` (check): CHECK ((btrim(text) <> ''::text))
- `example_translation_check` (check): CHECK ((jsonb_typeof(translation) = 'object'::text))

**Chỉ mục**:
- `example_by_external_id`: CREATE INDEX example_by_external_id ON core.example USING btree (external_id) WHERE (external_id IS NOT NULL)
- `example_by_sense`: CREATE INDEX example_by_sense ON core.example USING btree (sense_id, language_id) WHERE (sense_id IS NOT NULL)
- `example_source_per_sense`: CREATE UNIQUE INDEX example_source_per_sense ON core.example USING btree (sense_id, external_id) WHERE ((sense_id IS NOT NULL) AND (external_id IS NOT NULL))
- `example_unlinked_source`: CREATE UNIQUE INDEX example_unlinked_source ON core.example USING btree (external_id) WHERE ((sense_id IS NULL) AND (external_id IS NOT NULL))

<a id="coreexample_annotation"></a>
### `core.example_annotation`

*table — 32,311 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | bigint | không | identity |  |
| 2 | `source_example_id` | bigint | không |  |  |
| 3 | `canonical_example_id` | bigint | có |  |  |
| 4 | `source_sentence_id` | bigint | có |  |  |
| 5 | `match_text` | text | có |  |  |
| 6 | `embedded_sentence` | text | có |  |  |
| 7 | `embedded_translation` | text | có |  |  |
| 8 | `match_status` | text | không | 'pending'::text |  |
| 9 | `match_reason` | text | có |  |  |
| 10 | `evidence` | jsonb | không | '{}'::jsonb |  |
| 11 | `mapping_run_id` | bigint | có |  |  |
| 12 | `source_id` | integer | có |  |  |
| 13 | `batch_id` | uuid | có |  |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `example_annotation_batch_id_fkey`: FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id)
- `example_annotation_canonical_example_id_fkey`: FOREIGN KEY (canonical_example_id) REFERENCES core.example(id) ON DELETE RESTRICT
- `example_annotation_mapping_run_id_fkey`: FOREIGN KEY (mapping_run_id) REFERENCES core.mapping_run(id)
- `example_annotation_source_example_id_fkey`: FOREIGN KEY (source_example_id) REFERENCES core.example(id) ON DELETE RESTRICT
- `example_annotation_source_id_fkey`: FOREIGN KEY (source_id) REFERENCES source(id)

**Ràng buộc khác**:
- `example_annotation_evidence_check` (check): CHECK ((jsonb_typeof(evidence) = 'object'::text))
- `example_annotation_match_status_check` (check): CHECK ((match_status = ANY (ARRAY['matched'::text, 'missing_snapshot'::text, 'text_mismatch'::text, 'pending'::text, 'rejected'::text])))
- `example_annotation_not_self` (check): CHECK (((canonical_example_id IS NULL) OR (canonical_example_id <> source_example_id)))
- `example_annotation_source_example_id_key` (unique): UNIQUE (source_example_id)

**Chỉ mục**:
- `example_annotation_canonical`: CREATE INDEX example_annotation_canonical ON core.example_annotation USING btree (canonical_example_id) WHERE (canonical_example_id IS NOT NULL)
- `example_annotation_status`: CREATE INDEX example_annotation_status ON core.example_annotation USING btree (match_status, source_sentence_id)

<a id="coreexample_concept"></a>
### `core.example_concept`

*table — 360,063 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `example_id` | bigint | không |  |  |
| 2 | `concept_id` | bigint | không |  |  |
| 3 | `confidence` | real | có |  |  |
| 4 | `method` | text | không |  |  |
| 5 | `verified` | boolean | không | false |  |
| 6 | `mapping_run_id` | bigint | có |  |  |
| 7 | `evidence` | jsonb | không | '{}'::jsonb |  |

**Khoá chính**: `PRIMARY KEY (example_id, concept_id)`

**Khoá ngoại**:
- `example_concept_concept_id_fkey`: FOREIGN KEY (concept_id) REFERENCES core.concept(id) ON DELETE RESTRICT
- `example_concept_example_id_fkey`: FOREIGN KEY (example_id) REFERENCES core.example(id) ON DELETE RESTRICT
- `example_concept_mapping_run_id_fkey`: FOREIGN KEY (mapping_run_id) REFERENCES core.mapping_run(id)

**Ràng buộc khác**:
- `example_concept_confidence_check` (check): CHECK (((confidence >= (0)::double precision) AND (confidence <= (1)::double precision)))
- `example_concept_evidence_check` (check): CHECK ((jsonb_typeof(evidence) = 'object'::text))
- `example_concept_method_check` (check): CHECK ((btrim(method) <> ''::text))

**Chỉ mục**:
- `example_concept_by_concept`: CREATE INDEX example_concept_by_concept ON core.example_concept USING btree (concept_id, confidence DESC)

<a id="coreexample_sense"></a>
### `core.example_sense`

*table — 32,284 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `example_id` | bigint | không |  |  |
| 2 | `sense_id` | bigint | không |  |  |
| 3 | `relation` | text | không | 'illustrates'::text |  |
| 4 | `confidence` | real | có |  |  |
| 5 | `method` | text | không |  |  |
| 6 | `verified` | boolean | không | false |  |
| 7 | `mapping_run_id` | bigint | có |  |  |
| 8 | `evidence` | jsonb | không | '{}'::jsonb |  |

**Khoá chính**: `PRIMARY KEY (example_id, sense_id)`

**Khoá ngoại**:
- `example_sense_example_id_fkey`: FOREIGN KEY (example_id) REFERENCES core.example(id) ON DELETE RESTRICT
- `example_sense_mapping_run_id_fkey`: FOREIGN KEY (mapping_run_id) REFERENCES core.mapping_run(id)
- `example_sense_sense_id_fkey`: FOREIGN KEY (sense_id) REFERENCES core.sense(id) ON DELETE RESTRICT

**Ràng buộc khác**:
- `example_sense_confidence_check` (check): CHECK (((confidence >= (0)::double precision) AND (confidence <= (1)::double precision)))
- `example_sense_evidence_check` (check): CHECK ((jsonb_typeof(evidence) = 'object'::text))
- `example_sense_method_check` (check): CHECK ((btrim(method) <> ''::text))
- `example_sense_relation_check` (check): CHECK ((relation = ANY (ARRAY['illustrates'::text, 'candidate'::text, 'rejected'::text])))

**Chỉ mục**:
- `example_sense_by_sense`: CREATE INDEX example_sense_by_sense ON core.example_sense USING btree (sense_id, confidence DESC)

<a id="coreexample_translation"></a>
### `core.example_translation`

*table — 872,814 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `example_id` | bigint | không |  |  |
| 2 | `translation_id` | bigint | không |  |  |
| 3 | `batch_id` | uuid | không |  |  |

**Khoá chính**: `PRIMARY KEY (example_id, translation_id)`

**Khoá ngoại**:
- `example_translation_batch_id_fkey`: FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id)
- `example_translation_example_id_fkey`: FOREIGN KEY (example_id) REFERENCES core.example(id)
- `example_translation_translation_id_fkey`: FOREIGN KEY (translation_id) REFERENCES core.example(id)

**Ràng buộc khác**:
- `example_translation_check1` (check): CHECK ((example_id <> translation_id))

**Chỉ mục**:
- `example_translation_target`: CREATE INDEX example_translation_target ON core.example_translation USING btree (translation_id, example_id)

<a id="corejlpt_link"></a>
### `core.jlpt_link`

*table — 8,480 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | bigint | không | identity |  |
| 2 | `source_level` | smallint | không |  |  |
| 3 | `source_row_number` | integer | không |  |  |
| 4 | `variant_index` | smallint | không | 1 |  |
| 5 | `expression` | text | không |  |  |
| 6 | `reading` | text | có |  |  |
| 7 | `lexeme_id` | bigint | có |  |  |
| 8 | `status` | text | không | 'unresolved'::text |  |
| 9 | `match_method` | text | có |  |  |
| 10 | `score` | real | có |  |  |
| 11 | `evidence` | jsonb | không | '{}'::jsonb |  |
| 12 | `mapping_run_id` | bigint | có |  |  |
| 13 | `source_id` | integer | không |  |  |
| 14 | `batch_id` | uuid | không |  |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `jlpt_link_batch_id_fkey`: FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id)
- `jlpt_link_lexeme_id_fkey`: FOREIGN KEY (lexeme_id) REFERENCES core.lexeme(id) ON DELETE RESTRICT
- `jlpt_link_mapping_run_id_fkey`: FOREIGN KEY (mapping_run_id) REFERENCES core.mapping_run(id)
- `jlpt_link_source_id_fkey`: FOREIGN KEY (source_id) REFERENCES source(id)
- `jlpt_link_source_level_source_row_number_fkey`: FOREIGN KEY (source_level, source_row_number) REFERENCES staging.jlpt_entry(level, row_number)

**Ràng buộc khác**:
- `jlpt_link_evidence_check` (check): CHECK ((jsonb_typeof(evidence) = 'object'::text))
- `jlpt_link_score_check` (check): CHECK (((score >= (0)::double precision) AND (score <= (1)::double precision)))
- `jlpt_link_status_check` (check): CHECK ((status = ANY (ARRAY['accepted'::text, 'ambiguous'::text, 'unmatched'::text, 'pattern'::text, 'unresolved'::text, 'rejected'::text])))
- `jlpt_link_variant_index_check` (check): CHECK ((variant_index > 0))
- `jlpt_link_source_level_source_row_number_variant_index_lexe_key` (unique): UNIQUE (source_level, source_row_number, variant_index, lexeme_id)

**Chỉ mục**:
- `jlpt_link_lexeme`: CREATE INDEX jlpt_link_lexeme ON core.jlpt_link USING btree (lexeme_id, status)
- `jlpt_link_status`: CREATE INDEX jlpt_link_status ON core.jlpt_link USING btree (status, source_level, expression)

<a id="corekanji"></a>
### `core.kanji`

*table — 13,108 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `literal` | text | không |  |  |
| 2 | `codepoint_ucs` | integer | có |  |  |
| 3 | `grade` | smallint | có |  |  |
| 4 | `stroke_count` | smallint | có |  |  |
| 5 | `frequency_rank` | integer | có |  |  |
| 6 | `jlpt_old` | smallint | có |  |  |
| 7 | `radical_classical` | smallint | có |  |  |
| 8 | `readings` | jsonb | không | '{}'::jsonb |  |
| 9 | `meanings` | jsonb | không | '{}'::jsonb |  |
| 10 | `nanori` | jsonb | không | '[]'::jsonb |  |
| 11 | `query_codes` | jsonb | không | '{}'::jsonb |  |
| 12 | `dict_refs` | jsonb | không | '[]'::jsonb |  |
| 13 | `source_id` | integer | có |  |  |
| 14 | `batch_id` | uuid | có |  |  |
| 15 | `jlpt_new` | smallint | có |  |  |
| 16 | `jlpt_new_source_id` | integer | có |  |  |

**Khoá chính**: `PRIMARY KEY (literal)`

**Khoá ngoại**:
- `kanji_batch_id_fkey`: FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id)
- `kanji_jlpt_new_source_id_fkey`: FOREIGN KEY (jlpt_new_source_id) REFERENCES source(id)
- `kanji_source_id_fkey`: FOREIGN KEY (source_id) REFERENCES source(id)

**Ràng buộc khác**:
- `kanji_codepoint_ucs_check` (check): CHECK (((codepoint_ucs >= 0) AND (codepoint_ucs <= 1114111)))
- `kanji_dict_refs_check` (check): CHECK ((jsonb_typeof(dict_refs) = 'array'::text))
- `kanji_frequency_rank_check` (check): CHECK ((frequency_rank > 0))
- `kanji_grade_check` (check): CHECK ((grade > 0))
- `kanji_jlpt_new_check` (check): CHECK (((jlpt_new >= 1) AND (jlpt_new <= 5)))
- `kanji_jlpt_old_check` (check): CHECK (((jlpt_old >= 1) AND (jlpt_old <= 4)))
- `kanji_literal_check` (check): CHECK ((char_length(literal) = 1))
- `kanji_meanings_check` (check): CHECK ((jsonb_typeof(meanings) = 'object'::text))
- `kanji_nanori_check` (check): CHECK ((jsonb_typeof(nanori) = 'array'::text))
- `kanji_query_codes_check` (check): CHECK ((jsonb_typeof(query_codes) = 'object'::text))
- `kanji_radical_classical_check` (check): CHECK (((radical_classical >= 1) AND (radical_classical <= 214)))
- `kanji_readings_check` (check): CHECK ((jsonb_typeof(readings) = 'object'::text))
- `kanji_stroke_count_check` (check): CHECK ((stroke_count > 0))

**Chỉ mục**:
- `kanji_frequency`: CREATE INDEX kanji_frequency ON core.kanji USING btree (frequency_rank) WHERE (frequency_rank IS NOT NULL)

<a id="corekanji_media"></a>
### `core.kanji_media`

*table — 0 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `kanji_literal` | text | không |  |  |
| 2 | `asset_id` | bigint | không |  |  |
| 3 | `kind` | text | không |  |  |
| 4 | `frame_count` | smallint | có |  |  |

**Khoá chính**: `PRIMARY KEY (kanji_literal, kind)`

**Khoá ngoại**:
- `kanji_media_asset_id_fkey`: FOREIGN KEY (asset_id) REFERENCES core.media_asset(id) ON DELETE RESTRICT
- `kanji_media_kanji_literal_fkey`: FOREIGN KEY (kanji_literal) REFERENCES core.kanji(literal) ON DELETE CASCADE

**Ràng buộc khác**:
- `kanji_media_frame_count_check` (check): CHECK ((frame_count > 0))
- `kanji_media_kind_check` (check): CHECK ((kind = ANY (ARRAY['stroke_svg'::text, 'stroke_gif'::text])))

<a id="corekanji_radical"></a>
### `core.kanji_radical`

*table — 54,321 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `kanji_literal` | text | không |  |  |
| 2 | `part` | text | không |  |  |
| 3 | `position` | smallint | có |  | Thứ tự trong KRADFILE; không phải thứ tự viết nét. |
| 4 | `source_id` | integer | có |  |  |
| 5 | `batch_id` | uuid | có |  |  |

**Khoá chính**: `PRIMARY KEY (kanji_literal, part)`

**Khoá ngoại**:
- `kanji_radical_batch_id_fkey`: FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id)
- `kanji_radical_kanji_literal_fkey`: FOREIGN KEY (kanji_literal) REFERENCES core.kanji(literal) ON DELETE CASCADE
- `kanji_radical_source_id_fkey`: FOREIGN KEY (source_id) REFERENCES source(id)

**Ràng buộc khác**:
- `kanji_radical_part_check` (check): CHECK ((btrim(part) <> ''::text))
- `kanji_radical_position_check` (check): CHECK (("position" > 0))

**Chỉ mục**:
- `kanji_radical_part`: CREATE INDEX kanji_radical_part ON core.kanji_radical USING btree (part, kanji_literal)

<a id="corelexeme"></a>
### `core.lexeme`

*table — 2,375,240 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | bigint | không | identity |  |
| 2 | `language_id` | smallint | không |  |  |
| 3 | `lemma` | text | không |  |  |
| 4 | `pos` | text | không | 'unknown'::text |  |
| 5 | `reading` | text | có |  |  |
| 6 | `romanization` | text | có |  |  |
| 7 | `homograph_no` | smallint | không | 1 |  |
| 8 | `frequency_rank` | integer | có |  |  |
| 9 | `attributes` | jsonb | không | '{}'::jsonb |  |
| 10 | `external_id` | text | có |  |  |
| 11 | `source_id` | integer | có |  |  |
| 12 | `batch_id` | uuid | có |  |  |
| 13 | `content_hash` | text | có |  |  |
| 14 | `created_at` | timestamp with time zone | không | now() |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `lexeme_batch_id_fkey`: FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id)
- `lexeme_language_id_fkey`: FOREIGN KEY (language_id) REFERENCES language(id)
- `lexeme_source_id_fkey`: FOREIGN KEY (source_id) REFERENCES source(id)

**Ràng buộc khác**:
- `lexeme_attributes_check` (check): CHECK ((jsonb_typeof(attributes) = 'object'::text))
- `lexeme_external_id_check` (check): CHECK (((external_id IS NULL) OR (btrim(external_id) <> ''::text)))
- `lexeme_external_source` (check): CHECK (((external_id IS NULL) OR (source_id IS NOT NULL)))
- `lexeme_frequency_rank_check` (check): CHECK ((frequency_rank > 0))
- `lexeme_homograph_no_check` (check): CHECK ((homograph_no > 0))
- `lexeme_lemma_check` (check): CHECK ((btrim(lemma) <> ''::text))
- `lexeme_pos_check` (check): CHECK ((pos = ANY (ARRAY['noun'::text, 'verb'::text, 'adjective'::text, 'adverb'::text, 'pronoun'::text, 'determiner'::text, 'particle'::text, 'auxiliary'::text, 'conjunction'::text, 'interjection'::text, 'expression'::text, 'counter'::text, 'prefix'::text, 'suffix'::text, 'unknown'::text])))
- `lexeme_external_id_key` (unique): UNIQUE (external_id)
- `lexeme_natural_key` (unique): UNIQUE (language_id, lemma, pos, homograph_no)

**Chỉ mục**:
- `lexeme_frequency`: CREATE INDEX lexeme_frequency ON core.lexeme USING btree (language_id, frequency_rank) WHERE (frequency_rank IS NOT NULL)
- `lexeme_kana_forms`: CREATE INDEX lexeme_kana_forms ON core.lexeme USING gin (((attributes -> 'kana'::text)) jsonb_path_ops)
- `lexeme_kanji_forms`: CREATE INDEX lexeme_kanji_forms ON core.lexeme USING gin (((attributes -> 'kanji'::text)) jsonb_path_ops)
- `lexeme_lemma_bigm`: CREATE INDEX lexeme_lemma_bigm ON core.lexeme USING gin (core.bigrams(lower(lemma)))
- `lexeme_lemma_lookup`: CREATE INDEX lexeme_lemma_lookup ON core.lexeme USING btree (language_id, lemma)
- `lexeme_lemma_prefix`: CREATE INDEX lexeme_lemma_prefix ON core.lexeme USING btree (lemma text_pattern_ops)
- `lexeme_reading_bigm`: CREATE INDEX lexeme_reading_bigm ON core.lexeme USING gin (core.bigrams(lower(reading)))
- `lexeme_reading_lookup`: CREATE INDEX lexeme_reading_lookup ON core.lexeme USING btree (language_id, reading) WHERE (reading IS NOT NULL)
- `lexeme_reading_prefix`: CREATE INDEX lexeme_reading_prefix ON core.lexeme USING btree (reading text_pattern_ops) WHERE (reading IS NOT NULL)
- `lexeme_romanization_bigm`: CREATE INDEX lexeme_romanization_bigm ON core.lexeme USING gin (core.bigrams(lower(romanization)))

<a id="corelexeme_form"></a>
### `core.lexeme_form`

*table — 499,183 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | bigint | không | identity |  |
| 2 | `lexeme_id` | bigint | không |  |  |
| 3 | `kind` | text | không |  |  |
| 4 | `form_text` | text | không |  |  |
| 5 | `form_order` | smallint | không |  |  |
| 6 | `is_common` | boolean | không | false |  |
| 7 | `attributes` | jsonb | không | '{}'::jsonb |  |
| 8 | `source_id` | integer | có |  |  |
| 9 | `batch_id` | uuid | có |  |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `lexeme_form_batch_id_fkey`: FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id)
- `lexeme_form_lexeme_id_fkey`: FOREIGN KEY (lexeme_id) REFERENCES core.lexeme(id) ON DELETE RESTRICT
- `lexeme_form_source_id_fkey`: FOREIGN KEY (source_id) REFERENCES source(id)

**Ràng buộc khác**:
- `lexeme_form_attributes_check` (check): CHECK ((jsonb_typeof(attributes) = 'object'::text))
- `lexeme_form_form_order_check` (check): CHECK ((form_order > 0))
- `lexeme_form_form_text_check` (check): CHECK ((btrim(form_text) <> ''::text))
- `lexeme_form_kind_check` (check): CHECK ((kind = ANY (ARRAY['kanji'::text, 'kana'::text])))
- `lexeme_form_order_unique` (unique): UNIQUE (lexeme_id, kind, form_order)
- `lexeme_form_text_unique` (unique): UNIQUE (lexeme_id, kind, form_text)

**Chỉ mục**:
- `lexeme_form_by_lexeme`: CREATE INDEX lexeme_form_by_lexeme ON core.lexeme_form USING btree (lexeme_id, kind, form_order)
- `lexeme_form_lookup`: CREATE INDEX lexeme_form_lookup ON core.lexeme_form USING btree (kind, form_text, lexeme_id)
- `lexeme_form_text_bigm`: CREATE INDEX lexeme_form_text_bigm ON core.lexeme_form USING gin (core.bigrams(lower(form_text)))

<a id="corelexeme_form_applies_to"></a>
### `core.lexeme_form_applies_to`

*table — 249,619 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `form_id` | bigint | không |  |  |
| 2 | `target_form_id` | bigint | không |  |  |

**Khoá chính**: `PRIMARY KEY (form_id, target_form_id)`

**Khoá ngoại**:
- `lexeme_form_applies_to_form_id_fkey`: FOREIGN KEY (form_id) REFERENCES core.lexeme_form(id) ON DELETE CASCADE
- `lexeme_form_applies_to_target_form_id_fkey`: FOREIGN KEY (target_form_id) REFERENCES core.lexeme_form(id) ON DELETE CASCADE

**Ràng buộc khác**:
- `form_applies_to_different_kind` (check): CHECK ((form_id <> target_form_id))

**Chỉ mục**:
- `lexeme_form_applies_target`: CREATE INDEX lexeme_form_applies_target ON core.lexeme_form_applies_to USING btree (target_form_id, form_id)

<a id="corelexeme_form_char"></a>
### `core.lexeme_form_char`

*table — 853,943 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `form_id` | bigint | không |  |  |
| 2 | `char_position` | integer | không |  |  |
| 3 | `literal` | text | không |  |  |
| 4 | `codepoint_ucs` | integer | không |  |  |
| 5 | `character_kind` | text | không |  |  |
| 6 | `kanji_literal` | text | có |  |  |

**Khoá chính**: `PRIMARY KEY (form_id, char_position)`

**Khoá ngoại**:
- `lexeme_form_char_form_id_fkey`: FOREIGN KEY (form_id) REFERENCES core.lexeme_form(id) ON DELETE CASCADE
- `lexeme_form_char_kanji_literal_fkey`: FOREIGN KEY (kanji_literal) REFERENCES core.kanji(literal) ON DELETE RESTRICT

**Ràng buộc khác**:
- `lexeme_form_char_char_position_check` (check): CHECK ((char_position > 0))
- `lexeme_form_char_character_kind_check` (check): CHECK ((character_kind = ANY (ARRAY['kanji'::text, 'kana'::text, 'latin'::text, 'digit'::text, 'punctuation'::text, 'symbol'::text, 'other'::text])))
- `lexeme_form_char_codepoint_ucs_check` (check): CHECK (((codepoint_ucs >= 0) AND (codepoint_ucs <= 1114111)))
- `lexeme_form_char_literal_check` (check): CHECK ((char_length(literal) = 1))

**Chỉ mục**:
- `lexeme_form_char_kanji`: CREATE INDEX lexeme_form_char_kanji ON core.lexeme_form_char USING btree (kanji_literal) WHERE (kanji_literal IS NOT NULL)
- `lexeme_form_char_literal`: CREATE INDEX lexeme_form_char_literal ON core.lexeme_form_char USING btree (literal, character_kind)

<a id="corelexeme_form_kanji_char"></a>
### `core.lexeme_form_kanji_char`

*table — 588,916 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `form_id` | bigint | không |  |  |
| 2 | `char_position` | integer | không |  |  |
| 3 | `kanji_literal` | text | không |  |  |

**Khoá chính**: `PRIMARY KEY (form_id, char_position)`

**Khoá ngoại**:
- `lexeme_form_kanji_char_form_id_fkey`: FOREIGN KEY (form_id) REFERENCES core.lexeme_form(id) ON DELETE CASCADE
- `lexeme_form_kanji_char_kanji_literal_fkey`: FOREIGN KEY (kanji_literal) REFERENCES core.kanji(literal) ON DELETE RESTRICT

**Ràng buộc khác**:
- `kanji_char_is_single_codepoint` (check): CHECK ((char_length(kanji_literal) = 1))
- `lexeme_form_kanji_char_char_position_check` (check): CHECK ((char_position > 0))

**Chỉ mục**:
- `lexeme_form_kanji_char_by_literal`: CREATE INDEX lexeme_form_kanji_char_by_literal ON core.lexeme_form_kanji_char USING btree (kanji_literal, form_id)

<a id="corelexeme_form_tag"></a>
### `core.lexeme_form_tag`

*table — 31,224 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `form_id` | bigint | không |  |  |
| 2 | `tag_code` | text | không |  |  |

**Khoá chính**: `PRIMARY KEY (form_id, tag_code)`

**Khoá ngoại**:
- `lexeme_form_tag_form_id_fkey`: FOREIGN KEY (form_id) REFERENCES core.lexeme_form(id) ON DELETE CASCADE
- `lexeme_form_tag_tag_code_fkey`: FOREIGN KEY (tag_code) REFERENCES tag(code)

**Chỉ mục**:
- `lexeme_form_tag_code`: CREATE INDEX lexeme_form_tag_code ON core.lexeme_form_tag USING btree (tag_code, form_id)

<a id="corelexeme_level"></a>
### `core.lexeme_level`

*table — 7,810 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `lexeme_id` | bigint | không |  |  |
| 2 | `scheme` | text | không |  |  |
| 4 | `match_method` | text | không |  |  |
| 5 | `source_id` | integer | không |  |  |
| 6 | `batch_id` | uuid | không |  |  |

**Khoá chính**: `PRIMARY KEY (lexeme_id, scheme)`

**Khoá ngoại**:
- `lexeme_level_batch_id_fkey`: FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id)
- `lexeme_level_lexeme_id_fkey`: FOREIGN KEY (lexeme_id) REFERENCES core.lexeme(id)
- `lexeme_level_source_id_fkey`: FOREIGN KEY (source_id) REFERENCES source(id)

**Ràng buộc khác**:
- `lexeme_level_level_check` (check): CHECK (((level >= 1) AND (level <= 5)))
- `lexeme_level_match_method_check` (check): CHECK ((match_method = ANY (ARRAY['form_reading'::text, 'lemma_reading'::text])))
- `lexeme_level_scheme_check` (check): CHECK ((scheme = 'JLPT'::text))

**Chỉ mục**:
- `lexeme_level_lookup`: CREATE INDEX lexeme_level_lookup ON core.lexeme_level USING btree (scheme, level, lexeme_id)

<a id="coremapping_run"></a>
### `core.mapping_run`

*table — 20 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | bigint | không | identity |  |
| 2 | `run_key` | text | không |  |  |
| 3 | `task` | text | không |  |  |
| 4 | `algorithm` | text | không |  |  |
| 5 | `model` | text | có |  |  |
| 6 | `prompt_version` | text | có |  |  |
| 7 | `source_snapshot` | jsonb | không | '{}'::jsonb |  |
| 8 | `parameters` | jsonb | không | '{}'::jsonb |  |
| 9 | `status` | text | không | 'running'::text |  |
| 10 | `started_at` | timestamp with time zone | không | now() |  |
| 11 | `finished_at` | timestamp with time zone | có |  |  |
| 12 | `rows_seen` | bigint | có |  |  |
| 13 | `rows_accepted` | bigint | có |  |  |
| 14 | `rows_rejected` | bigint | có |  |  |
| 15 | `rows_unresolved` | bigint | có |  |  |
| 16 | `error` | text | có |  |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Ràng buộc khác**:
- `mapping_run_algorithm_check` (check): CHECK ((btrim(algorithm) <> ''::text))
- `mapping_run_parameters_check` (check): CHECK ((jsonb_typeof(parameters) = 'object'::text))
- `mapping_run_source_snapshot_check` (check): CHECK ((jsonb_typeof(source_snapshot) = 'object'::text))
- `mapping_run_status_check` (check): CHECK ((status = ANY (ARRAY['running'::text, 'dry_run'::text, 'completed'::text, 'failed'::text, 'rolled_back'::text])))
- `mapping_run_task_check` (check): CHECK ((btrim(task) <> ''::text))
- `mapping_run_run_key_key` (unique): UNIQUE (run_key)

**Chỉ mục**:
- `mapping_run_task_status`: CREATE INDEX mapping_run_task_status ON core.mapping_run USING btree (task, status, started_at DESC)

<a id="coremedia_asset"></a>
### `core.media_asset`

*table — 6.461 dòng (VPS, 2026-10-30; M14.1 gồm 44 concept images)*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | bigint | không | identity |  |
| 2 | `kind` | text | không |  |  |
| 3 | `object_key` | text | không |  |  |
| 4 | `mime` | text | không |  |  |
| 5 | `bytes` | integer | có |  |  |
| 6 | `sha256` | text | có |  |  |
| 7 | `provider` | text | có |  |  |
| 8 | `source_id` | integer | có |  |  |
| 9 | `created_at` | timestamp with time zone | không | now() |  |
| 10 | `metadata` | jsonb | không | `{}` | Bucket, prompt/definition provenance; không chứa secret |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `media_asset_source_id_fkey`: FOREIGN KEY (source_id) REFERENCES source(id)

**Ràng buộc khác**:
- `media_asset_bytes_check` (check): CHECK ((bytes > 0))
- `media_asset_kind_check` (check): CHECK ((kind = ANY (ARRAY['stroke_svg'::text, 'stroke_gif'::text, 'audio_tts'::text, 'concept_image'::text])))
- `media_asset_object_key_check` (check): CHECK ((btrim(object_key) <> ''::text))
- `media_asset_object_key_key` (unique): UNIQUE (object_key)

**Chỉ mục**:
- `media_asset_by_kind`: CREATE INDEX media_asset_by_kind ON core.media_asset USING btree (kind)

- `media_asset_metadata_object`: metadata phải là JSON object.
- `media_asset_image_integrity`: concept_image cần MIME PNG/JPEG/WebP, bytes > 0, SHA-256 hex 64 ký tự.

<a id="coreconcept_media"></a>
### `core.concept_media`

*table — 44 dòng (VPS, 2026-10-30; M14.1, 40 primary + 4 alternate)*

| Cột | Kiểu | Null / mặc định |
| --- | --- | --- |
| concept_id | bigint | NOT NULL, FK core.concept(id), RESTRICT |
| asset_id | bigint | NOT NULL, FK core.media_asset(id), RESTRICT |
| anchor_sense_id | bigint | NOT NULL, FK core.sense(id), RESTRICT |
| status | text | NOT NULL, pending; pending/approved/rejected |
| is_primary | boolean | NOT NULL, false |
| created_at | timestamptz | NOT NULL, now() |
| reviewed_at | timestamptz | nullable |
| reviewed_by_label | text | nullable, không rỗng khi có |

PK `(concept_id, asset_id)`; partial unique một approved primary/concept; index anchor sense.
Review time/label phải cùng có hoặc cùng null; approved cần review, primary cần approved.
Không FK composite tới sense_concept để curation vẫn sửa/xóa mapping được.

<a id="serveconcept_image"></a>
### `serve.concept_image`

*view — 40 dòng (VPS, 2026-10-30; M14.1 sau upload/gắn 40 ảnh lô 1–2)*

Cột: `concept_id`, `asset_id`, `anchor_sense_id`, `object_key`, `mime`, `bytes`, `sha256`, `provider`.
Concept draft/curated (review/rejected bị ẩn), link approved primary, media kind concept_image, anchor mapping hiện tại
exact + verified + confidence ≥ 0.7. Mapping đổi/xóa thì ảnh tự ẩn. Consumer dựng URL bằng
public base cấu hình + `/` + object_key; không chứa URL tạm hoặc credentials.
Chi tiết: [M14.1 report](docs/reviews/m14.1-r2-concept-images-2026-10-30.md).

<a id="corepronunciation"></a>
### `core.pronunciation`

*table — 609,858 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | bigint | không | identity |  |
| 2 | `lexeme_id` | bigint | không |  |  |
| 3 | `ipa` | text | có |  |  |
| 4 | `audio_key` | text | có |  |  |
| 5 | `dialect` | text | có |  |  |
| 6 | `source_id` | integer | có |  |  |
| 7 | `batch_id` | uuid | có |  |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `pronunciation_batch_id_fkey`: FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id)
- `pronunciation_lexeme_id_fkey`: FOREIGN KEY (lexeme_id) REFERENCES core.lexeme(id) ON DELETE RESTRICT
- `pronunciation_source_id_fkey`: FOREIGN KEY (source_id) REFERENCES source(id)

**Ràng buộc khác**:
- `pronunciation_has_content` (check): CHECK ((((ipa IS NOT NULL) AND (btrim(ipa) <> ''::text)) OR ((audio_key IS NOT NULL) AND (btrim(audio_key) <> ''::text))))

**Chỉ mục**:
- `pronunciation_by_lexeme`: CREATE INDEX pronunciation_by_lexeme ON core.pronunciation USING btree (lexeme_id)

<a id="coresense"></a>
### `core.sense`

*table — 2,917,954 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | bigint | không | identity |  |
| 2 | `lexeme_id` | bigint | không |  |  |
| 3 | `sense_no` | smallint | không |  |  |
| 4 | `definition` | text | có |  |  |
| 5 | `register` | text | có |  |  |
| 6 | `domain` | text | có |  |  |
| 7 | `is_primary` | boolean | không | false |  |
| 8 | `external_id` | text | có |  |  |
| 9 | `attributes` | jsonb | không | '{}'::jsonb |  |
| 10 | `source_id` | integer | có |  |  |
| 11 | `batch_id` | uuid | có |  |  |
| 12 | `definition_language_id` | smallint | có |  | Ngôn ngữ của definition cache; có thể khác ngôn ngữ của lexeme. |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `sense_batch_id_fkey`: FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id)
- `sense_definition_language_id_fkey`: FOREIGN KEY (definition_language_id) REFERENCES language(id)
- `sense_lexeme_id_fkey`: FOREIGN KEY (lexeme_id) REFERENCES core.lexeme(id) ON DELETE RESTRICT
- `sense_source_id_fkey`: FOREIGN KEY (source_id) REFERENCES source(id)

**Ràng buộc khác**:
- `sense_attributes_check` (check): CHECK ((jsonb_typeof(attributes) = 'object'::text))
- `sense_external_id_check` (check): CHECK (((external_id IS NULL) OR (btrim(external_id) <> ''::text)))
- `sense_external_source` (check): CHECK (((external_id IS NULL) OR (source_id IS NOT NULL)))
- `sense_register_check` (check): CHECK ((register = ANY (ARRAY['formal'::text, 'colloquial'::text, 'archaic'::text, 'slang'::text])))
- `sense_sense_no_check` (check): CHECK ((sense_no > 0))
- `sense_external_id_key` (unique): UNIQUE (external_id)
- `sense_order_per_lexeme` (unique): UNIQUE (lexeme_id, sense_no)

**Chỉ mục**:
- `sense_one_primary`: CREATE UNIQUE INDEX sense_one_primary ON core.sense USING btree (lexeme_id) WHERE is_primary

<a id="coresense_concept"></a>
### `core.sense_concept`

*table — 577,525 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `sense_id` | bigint | không |  |  |
| 2 | `concept_id` | bigint | không |  |  |
| 3 | `relation` | text | không | 'exact'::text |  |
| 4 | `confidence` | real | không | 1.0 |  |
| 5 | `method` | text | không |  |  |
| 6 | `verified` | boolean | không | false | true = liên kết nguồn chuẩn (WordNet/OMW) hoặc do người duyệt; false = máy/LLM chưa audit. |
| 7 | `source_id` | integer | có |  |  |
| 8 | `batch_id` | uuid | có |  |  |
| 9 | `mapping_run_id` | bigint | có |  |  |
| 10 | `decided_at` | timestamp with time zone | có |  |  |

**Khoá chính**: `PRIMARY KEY (sense_id, concept_id)`

**Khoá ngoại**:
- `sense_concept_batch_id_fkey`: FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id)
- `sense_concept_concept_id_fkey`: FOREIGN KEY (concept_id) REFERENCES core.concept(id) ON DELETE RESTRICT
- `sense_concept_mapping_run_id_fkey`: FOREIGN KEY (mapping_run_id) REFERENCES core.mapping_run(id)
- `sense_concept_sense_id_fkey`: FOREIGN KEY (sense_id) REFERENCES core.sense(id) ON DELETE RESTRICT
- `sense_concept_source_id_fkey`: FOREIGN KEY (source_id) REFERENCES source(id)

**Ràng buộc khác**:
- `sense_concept_confidence_check` (check): CHECK (((confidence >= (0.0)::double precision) AND (confidence <= (1.0)::double precision)))
- `sense_concept_method_check` (check): CHECK ((btrim(method) <> ''::text))
- `sense_concept_relation_check` (check): CHECK ((relation = ANY (ARRAY['exact'::text, 'broader'::text, 'narrower'::text, 'related'::text])))

**Chỉ mục**:
- `sense_concept_by_concept`: CREATE INDEX sense_concept_by_concept ON core.sense_concept USING btree (concept_id, confidence DESC)

<a id="coresense_concept_candidate"></a>
### `core.sense_concept_candidate`

*table — 685,757 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | bigint | không | identity |  |
| 2 | `run_id` | bigint | không |  |  |
| 3 | `sense_id` | bigint | không |  |  |
| 4 | `concept_id` | bigint | không |  |  |
| 5 | `relation` | text | không | 'exact'::text |  |
| 6 | `score` | real | có |  |  |
| 7 | `calibrated_score` | real | có |  |  |
| 8 | `decision` | text | không | 'pending'::text |  |
| 9 | `method` | text | không |  |  |
| 10 | `evidence` | jsonb | không | '{}'::jsonb |  |
| 11 | `llm_result` | jsonb | không | '{}'::jsonb |  |
| 12 | `artifact_hash` | text | có |  |  |
| 13 | `decided_at` | timestamp with time zone | có |  |  |
| 14 | `decision_run_id` | bigint | có |  | mapping_run đưa ra quyết định cuối (promote/reject) — dùng rollback theo lô. |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `sense_concept_candidate_concept_id_fkey`: FOREIGN KEY (concept_id) REFERENCES core.concept(id) ON DELETE RESTRICT
- `sense_concept_candidate_decision_run_id_fkey`: FOREIGN KEY (decision_run_id) REFERENCES core.mapping_run(id)
- `sense_concept_candidate_run_id_fkey`: FOREIGN KEY (run_id) REFERENCES core.mapping_run(id) ON DELETE RESTRICT
- `sense_concept_candidate_sense_id_fkey`: FOREIGN KEY (sense_id) REFERENCES core.sense(id) ON DELETE RESTRICT

**Ràng buộc khác**:
- `sense_concept_candidate_calibrated_score_check` (check): CHECK (((calibrated_score >= (0)::double precision) AND (calibrated_score <= (1)::double precision)))
- `sense_concept_candidate_decision_check` (check): CHECK ((decision = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text, 'stale'::text, 'uncertain'::text])))
- `sense_concept_candidate_evidence_check` (check): CHECK ((jsonb_typeof(evidence) = 'object'::text))
- `sense_concept_candidate_llm_result_check` (check): CHECK ((jsonb_typeof(llm_result) = 'object'::text))
- `sense_concept_candidate_method_check` (check): CHECK ((btrim(method) <> ''::text))
- `sense_concept_candidate_relation_check` (check): CHECK ((relation = ANY (ARRAY['exact'::text, 'broader'::text, 'narrower'::text, 'related'::text])))
- `sense_concept_candidate_score_check` (check): CHECK (((score >= (0)::double precision) AND (score <= (1)::double precision)))
- `sense_concept_candidate_run_id_sense_id_concept_id_relation_key` (unique): UNIQUE (run_id, sense_id, concept_id, relation)

**Chỉ mục**:
- `sense_concept_candidate_decision_run`: CREATE INDEX sense_concept_candidate_decision_run ON core.sense_concept_candidate USING btree (decision_run_id) WHERE (decision_run_id IS NOT NULL)
- `sense_concept_candidate_queue`: CREATE INDEX sense_concept_candidate_queue ON core.sense_concept_candidate USING btree (decision, run_id, score DESC)
- `sense_concept_candidate_sense`: CREATE INDEX sense_concept_candidate_sense ON core.sense_concept_candidate USING btree (sense_id, decision, calibrated_score DESC)

<a id="coresense_concept_candidate_review"></a>
### `core.sense_concept_candidate_review`

*table — 3,200 dòng*

> Các lượt LLM/người/quy tắc đánh giá candidate; không thay thế quyết định cuối ở candidate.

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | bigint | không | identity |  |
| 2 | `candidate_id` | bigint | không |  |  |
| 3 | `mapping_run_id` | bigint | không |  |  |
| 4 | `reviewer_kind` | text | không |  |  |
| 5 | `reviewer` | text | không |  |  |
| 6 | `question_type` | text | không |  |  |
| 7 | `prompt_version` | text | có |  |  |
| 8 | `relation` | text | có |  |  |
| 9 | `score` | real | có |  |  |
| 10 | `result` | jsonb | không | '{}'::jsonb |  |
| 11 | `artifact_hash` | text | có |  |  |
| 12 | `created_at` | timestamp with time zone | không | now() |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `sense_concept_candidate_review_candidate_id_fkey`: FOREIGN KEY (candidate_id) REFERENCES core.sense_concept_candidate(id) ON DELETE RESTRICT
- `sense_concept_candidate_review_mapping_run_id_fkey`: FOREIGN KEY (mapping_run_id) REFERENCES core.mapping_run(id) ON DELETE RESTRICT

**Ràng buộc khác**:
- `sense_concept_candidate_review_question_type_check` (check): CHECK ((btrim(question_type) <> ''::text))
- `sense_concept_candidate_review_relation_check` (check): CHECK (((relation IS NULL) OR (relation = ANY (ARRAY['exact'::text, 'broader'::text, 'narrower'::text, 'related'::text, 'none'::text, 'uncertain'::text]))))
- `sense_concept_candidate_review_result_check` (check): CHECK ((jsonb_typeof(result) = 'object'::text))
- `sense_concept_candidate_review_reviewer_check` (check): CHECK ((btrim(reviewer) <> ''::text))
- `sense_concept_candidate_review_reviewer_kind_check` (check): CHECK ((reviewer_kind = ANY (ARRAY['llm'::text, 'human'::text, 'rule'::text])))
- `sense_concept_candidate_review_score_check` (check): CHECK (((score IS NULL) OR ((score >= (0)::double precision) AND (score <= (1)::double precision))))
- `sense_concept_candidate_revie_candidate_id_mapping_run_id_r_key` (unique): UNIQUE (candidate_id, mapping_run_id, reviewer_kind, reviewer)

**Chỉ mục**:
- `sense_concept_candidate_review_candidate`: CREATE INDEX sense_concept_candidate_review_candidate ON core.sense_concept_candidate_review USING btree (candidate_id, created_at DESC)
- `sense_concept_candidate_review_run`: CREATE INDEX sense_concept_candidate_review_run ON core.sense_concept_candidate_review USING btree (mapping_run_id, reviewer_kind, score DESC)

<a id="coresense_form"></a>
### `core.sense_form`

*table — 591,745 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `sense_id` | bigint | không |  |  |
| 2 | `form_id` | bigint | không |  |  |

**Khoá chính**: `PRIMARY KEY (sense_id, form_id)`

**Khoá ngoại**:
- `sense_form_form_id_fkey`: FOREIGN KEY (form_id) REFERENCES core.lexeme_form(id) ON DELETE CASCADE
- `sense_form_sense_id_fkey`: FOREIGN KEY (sense_id) REFERENCES core.sense(id) ON DELETE CASCADE

**Chỉ mục**:
- `sense_form_by_form`: CREATE INDEX sense_form_by_form ON core.sense_form USING btree (form_id, sense_id)

<a id="coresense_gloss"></a>
### `core.sense_gloss`

*table — 2,530,921 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | bigint | không | identity |  |
| 2 | `sense_id` | bigint | không |  |  |
| 3 | `language_id` | smallint | không |  |  |
| 4 | `text` | text | không |  |  |
| 5 | `detail` | text | có |  |  |
| 6 | `is_machine` | boolean | không | false |  |
| 7 | `reviewed_by` | bigint | có |  |  |
| 8 | `reviewed_at` | timestamp with time zone | có |  |  |
| 9 | `quality` | smallint | có |  |  |
| 10 | `rank` | smallint | không | 1 |  |
| 11 | `source_id` | integer | có |  |  |
| 12 | `batch_id` | uuid | có |  |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `sense_gloss_batch_id_fkey`: FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id)
- `sense_gloss_language_id_fkey`: FOREIGN KEY (language_id) REFERENCES language(id)
- `sense_gloss_sense_id_fkey`: FOREIGN KEY (sense_id) REFERENCES core.sense(id) ON DELETE RESTRICT
- `sense_gloss_source_id_fkey`: FOREIGN KEY (source_id) REFERENCES source(id)

**Ràng buộc khác**:
- `sense_gloss_quality_check` (check): CHECK (((quality >= 0) AND (quality <= 100)))
- `sense_gloss_rank_check` (check): CHECK ((rank > 0))
- `sense_gloss_review_pair` (check): CHECK (((reviewed_by IS NULL) = (reviewed_at IS NULL)))
- `sense_gloss_text_check` (check): CHECK ((btrim(text) <> ''::text))
- `sense_gloss_slot` (unique): UNIQUE (sense_id, language_id, rank)

**Chỉ mục**:
- `sense_gloss_language`: CREATE INDEX sense_gloss_language ON core.sense_gloss USING btree (language_id, sense_id)

<a id="coresense_gloss_history"></a>
### `core.sense_gloss_history`

*table — 0 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | bigint | không | identity |  |
| 2 | `gloss_id` | bigint | không |  |  |
| 3 | `event` | text | không |  |  |
| 4 | `old_data` | jsonb | không |  |  |
| 5 | `new_data` | jsonb | có |  |  |
| 6 | `changed_at` | timestamp with time zone | không | now() |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Ràng buộc khác**:
- `sense_gloss_history_event_check` (check): CHECK ((event = ANY (ARRAY['update'::text, 'delete'::text])))
- `sense_gloss_history_shape` (check): CHECK ((((event = 'update'::text) AND (new_data IS NOT NULL)) OR ((event = 'delete'::text) AND (new_data IS NULL))))

**Chỉ mục**:
- `sense_gloss_history_by_gloss`: CREATE INDEX sense_gloss_history_by_gloss ON core.sense_gloss_history USING btree (gloss_id, changed_at DESC)

<a id="coresense_relation"></a>
### `core.sense_relation`

*table — 34,778 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `source_sense_id` | bigint | không |  |  |
| 2 | `target_sense_id` | bigint | không |  |  |
| 3 | `relation` | text | không |  |  |
| 4 | `confidence` | real | có |  |  |
| 5 | `method` | text | không |  |  |
| 6 | `verified` | boolean | không | false |  |
| 7 | `mapping_run_id` | bigint | có |  |  |
| 8 | `source_id` | integer | có |  |  |
| 9 | `batch_id` | uuid | có |  |  |

**Khoá chính**: `PRIMARY KEY (source_sense_id, target_sense_id, relation)`

**Khoá ngoại**:
- `sense_relation_batch_id_fkey`: FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id)
- `sense_relation_mapping_run_id_fkey`: FOREIGN KEY (mapping_run_id) REFERENCES core.mapping_run(id)
- `sense_relation_source_id_fkey`: FOREIGN KEY (source_id) REFERENCES source(id)
- `sense_relation_source_sense_id_fkey`: FOREIGN KEY (source_sense_id) REFERENCES core.sense(id) ON DELETE RESTRICT
- `sense_relation_target_sense_id_fkey`: FOREIGN KEY (target_sense_id) REFERENCES core.sense(id) ON DELETE RESTRICT

**Ràng buộc khác**:
- `sense_relation_confidence_check` (check): CHECK (((confidence >= (0)::double precision) AND (confidence <= (1)::double precision)))
- `sense_relation_relation_check` (check): CHECK ((relation = ANY (ARRAY['equivalent'::text, 'related'::text, 'antonym'::text, 'broader'::text, 'narrower'::text])))

**Chỉ mục**:
- `sense_relation_target`: CREATE INDEX sense_relation_target ON core.sense_relation USING btree (target_sense_id, relation)

<a id="coresense_relation_candidate"></a>
### `core.sense_relation_candidate`

*table — 3,275 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | bigint | không | identity |  |
| 2 | `source_sense_id` | bigint | không |  |  |
| 3 | `target_sense_id` | bigint | có |  |  |
| 4 | `target_lexeme_text` | text | có |  |  |
| 5 | `target_reading` | text | có |  |  |
| 6 | `relation` | text | không |  |  |
| 7 | `source_key` | text | không |  |  |
| 8 | `decision` | text | không | 'pending'::text |  |
| 9 | `score` | real | có |  |  |
| 10 | `method` | text | không |  |  |
| 11 | `evidence` | jsonb | không | '{}'::jsonb |  |
| 12 | `mapping_run_id` | bigint | có |  |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `sense_relation_candidate_mapping_run_id_fkey`: FOREIGN KEY (mapping_run_id) REFERENCES core.mapping_run(id)
- `sense_relation_candidate_source_sense_id_fkey`: FOREIGN KEY (source_sense_id) REFERENCES core.sense(id) ON DELETE RESTRICT
- `sense_relation_candidate_target_sense_id_fkey`: FOREIGN KEY (target_sense_id) REFERENCES core.sense(id) ON DELETE RESTRICT

**Ràng buộc khác**:
- `sense_relation_candidate_decision_check` (check): CHECK ((decision = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text, 'uncertain'::text])))
- `sense_relation_candidate_evidence_check` (check): CHECK ((jsonb_typeof(evidence) = 'object'::text))
- `sense_relation_candidate_relation_check` (check): CHECK ((relation = ANY (ARRAY['equivalent'::text, 'related'::text, 'antonym'::text, 'broader'::text, 'narrower'::text])))
- `sense_relation_candidate_score_check` (check): CHECK (((score >= (0)::double precision) AND (score <= (1)::double precision)))
- `sense_relation_candidate_source_key_key` (unique): UNIQUE (source_key)

**Chỉ mục**:
- `sense_relation_candidate_queue`: CREATE INDEX sense_relation_candidate_queue ON core.sense_relation_candidate USING btree (decision, relation, score DESC)

<a id="coresense_tag"></a>
### `core.sense_tag`

*table — 407,546 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `sense_id` | bigint | không |  |  |
| 2 | `tag_code` | text | không |  |  |

**Khoá chính**: `PRIMARY KEY (sense_id, tag_code)`

**Khoá ngoại**:
- `sense_tag_sense_id_fkey`: FOREIGN KEY (sense_id) REFERENCES core.sense(id) ON DELETE CASCADE
- `sense_tag_tag_code_fkey`: FOREIGN KEY (tag_code) REFERENCES tag(code)

**Chỉ mục**:
- `sense_tag_code`: CREATE INDEX sense_tag_code ON core.sense_tag USING btree (tag_code, sense_id)

<a id="coresource_entry_identity"></a>
### `core.source_entry_identity`

*table — 1,744,214 dòng*

> Crosswalk gọn giữa khóa nguồn của snapshot và core.lexeme; metadata chi tiết ở staging.

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | bigint | không | identity |  |
| 2 | `source_id` | integer | không |  |  |
| 3 | `source_snapshot` | text | không |  |  |
| 4 | `source_external_id` | text | không |  |  |
| 5 | `logical_key` | text | không |  |  |
| 6 | `content_hash` | text | có |  |  |
| 7 | `staging_row_id` | bigint | có |  |  |
| 8 | `lexeme_id` | bigint | có |  |  |
| 9 | `status` | text | không | 'active'::text |  |
| 10 | `created_at` | timestamp with time zone | không | now() |  |
| 11 | `updated_at` | timestamp with time zone | không | now() |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `source_entry_identity_lexeme_id_fkey`: FOREIGN KEY (lexeme_id) REFERENCES core.lexeme(id) ON DELETE RESTRICT
- `source_entry_identity_source_id_fkey`: FOREIGN KEY (source_id) REFERENCES source(id)

**Ràng buộc khác**:
- `source_entry_identity_status_check` (check): CHECK ((status = ANY (ARRAY['active'::text, 'changed'::text, 'removed'::text, 'ambiguous'::text, 'unresolved'::text])))
- `source_entry_identity_source_id_source_snapshot_source_exte_key` (unique): UNIQUE (source_id, source_snapshot, source_external_id)

**Chỉ mục**:
- `source_entry_identity_lexeme`: CREATE INDEX source_entry_identity_lexeme ON core.source_entry_identity USING btree (lexeme_id) WHERE (lexeme_id IS NOT NULL)
- `source_entry_identity_logical`: CREATE INDEX source_entry_identity_logical ON core.source_entry_identity USING btree (source_id, logical_key, status)

<a id="coresource_form"></a>
### `core.source_form`

*table — 2,226,072 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | bigint | không | identity |  |
| 2 | `lexeme_id` | bigint | không |  |  |
| 3 | `form_text` | text | không |  |  |
| 4 | `form_kind` | text | không | 'source'::text |  |
| 5 | `tags` | jsonb | không | '[]'::jsonb |  |
| 6 | `attributes` | jsonb | không | '{}'::jsonb |  |
| 7 | `source_ordinal` | smallint | không |  |  |
| 8 | `source_id` | integer | có |  |  |
| 9 | `batch_id` | uuid | có |  |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `source_form_batch_id_fkey`: FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id)
- `source_form_lexeme_id_fkey`: FOREIGN KEY (lexeme_id) REFERENCES core.lexeme(id) ON DELETE RESTRICT
- `source_form_source_id_fkey`: FOREIGN KEY (source_id) REFERENCES source(id)

**Ràng buộc khác**:
- `source_form_attributes_check` (check): CHECK ((jsonb_typeof(attributes) = 'object'::text))
- `source_form_form_kind_check` (check): CHECK ((btrim(form_kind) <> ''::text))
- `source_form_form_text_check` (check): CHECK ((btrim(form_text) <> ''::text))
- `source_form_source_ordinal_check` (check): CHECK ((source_ordinal > 0))
- `source_form_tags_check` (check): CHECK ((jsonb_typeof(tags) = 'array'::text))
- `source_form_lexeme_id_form_text_form_kind_source_ordinal_key` (unique): UNIQUE (lexeme_id, form_text, form_kind, source_ordinal)

**Chỉ mục**:
- `source_form_lexeme`: CREATE INDEX source_form_lexeme ON core.source_form USING btree (lexeme_id, form_kind)
- `source_form_lookup`: CREATE INDEX source_form_lookup ON core.source_form USING btree (form_text, form_kind)

<a id="coretranslation_assertion"></a>
### `core.translation_assertion`

*table — 99,412 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | bigint | không | identity |  |
| 2 | `source_lexeme_id` | bigint | không |  |  |
| 3 | `source_sense_id` | bigint | có |  |  |
| 4 | `target_language_id` | smallint | không |  |  |
| 5 | `target_text` | text | không |  |  |
| 6 | `romanization` | text | có |  |  |
| 7 | `tags` | jsonb | không | '[]'::jsonb |  |
| 8 | `sense_hint` | text | có |  |  |
| 9 | `scope` | text | không |  |  |
| 10 | `source_ordinal` | smallint | không |  |  |
| 11 | `source_key` | text | không |  |  |
| 12 | `source_id` | integer | có |  |  |
| 13 | `batch_id` | uuid | có |  |  |
| 14 | `mapping_run_id` | bigint | có |  |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `translation_assertion_batch_id_fkey`: FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id)
- `translation_assertion_mapping_run_id_fkey`: FOREIGN KEY (mapping_run_id) REFERENCES core.mapping_run(id)
- `translation_assertion_source_id_fkey`: FOREIGN KEY (source_id) REFERENCES source(id)
- `translation_assertion_source_lexeme_id_fkey`: FOREIGN KEY (source_lexeme_id) REFERENCES core.lexeme(id) ON DELETE RESTRICT
- `translation_assertion_source_sense_id_fkey`: FOREIGN KEY (source_sense_id) REFERENCES core.sense(id) ON DELETE RESTRICT
- `translation_assertion_target_language_id_fkey`: FOREIGN KEY (target_language_id) REFERENCES language(id)

**Ràng buộc khác**:
- `translation_assertion_scope_check` (check): CHECK ((scope = ANY (ARRAY['entry'::text, 'sense'::text])))
- `translation_assertion_source_ordinal_check` (check): CHECK ((source_ordinal > 0))
- `translation_assertion_tags_check` (check): CHECK ((jsonb_typeof(tags) = 'array'::text))
- `translation_assertion_target_text_check` (check): CHECK ((btrim(target_text) <> ''::text))
- `translation_assertion_source_key_key` (unique): UNIQUE (source_key)

**Chỉ mục**:
- `translation_assertion_source`: CREATE INDEX translation_assertion_source ON core.translation_assertion USING btree (source_lexeme_id, source_sense_id)
- `translation_assertion_target`: CREATE INDEX translation_assertion_target ON core.translation_assertion USING btree (target_language_id, target_text)

<a id="coretranslation_target_candidate"></a>
### `core.translation_target_candidate`

*table — 82,355 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | bigint | không | identity |  |
| 2 | `assertion_id` | bigint | không |  |  |
| 3 | `target_lexeme_id` | bigint | có |  |  |
| 4 | `target_sense_id` | bigint | có |  |  |
| 5 | `score` | real | có |  |  |
| 6 | `match_method` | text | không |  |  |
| 7 | `decision` | text | không | 'pending'::text |  |
| 8 | `evidence` | jsonb | không | '{}'::jsonb |  |
| 9 | `mapping_run_id` | bigint | có |  |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `translation_target_candidate_assertion_id_fkey`: FOREIGN KEY (assertion_id) REFERENCES core.translation_assertion(id) ON DELETE RESTRICT
- `translation_target_candidate_mapping_run_id_fkey`: FOREIGN KEY (mapping_run_id) REFERENCES core.mapping_run(id)
- `translation_target_candidate_target_lexeme_id_fkey`: FOREIGN KEY (target_lexeme_id) REFERENCES core.lexeme(id) ON DELETE RESTRICT
- `translation_target_candidate_target_sense_id_fkey`: FOREIGN KEY (target_sense_id) REFERENCES core.sense(id) ON DELETE RESTRICT

**Ràng buộc khác**:
- `translation_target_candidate_decision_check` (check): CHECK ((decision = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text, 'uncertain'::text])))
- `translation_target_candidate_evidence_check` (check): CHECK ((jsonb_typeof(evidence) = 'object'::text))
- `translation_target_candidate_score_check` (check): CHECK (((score >= (0)::double precision) AND (score <= (1)::double precision)))
- `translation_target_candidate_assertion_id_target_lexeme_id__key` (unique): UNIQUE (assertion_id, target_lexeme_id, target_sense_id, match_method)

**Chỉ mục**:
- `translation_candidate_queue`: CREATE INDEX translation_candidate_queue ON core.translation_target_candidate USING btree (decision, score DESC)

<a id="corewordnet_relation"></a>
### `core.wordnet_relation`

*table — 582,498 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `lexicon` | text | không |  |  |
| 2 | `source_synset_id` | text | không |  |  |
| 3 | `target_synset_id` | text | không |  |  |
| 4 | `rel_type` | text | không |  |  |
| 5 | `batch_id` | uuid | không |  |  |

**Khoá chính**: `PRIMARY KEY (lexicon, source_synset_id, target_synset_id, rel_type)`

**Khoá ngoại**:
- `wordnet_relation_batch_id_fkey`: FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id)
- `wordnet_relation_lexicon_source_synset_id_fkey`: FOREIGN KEY (lexicon, source_synset_id) REFERENCES core.wordnet_synset(lexicon, synset_id)
- `wordnet_relation_lexicon_target_synset_id_fkey`: FOREIGN KEY (lexicon, target_synset_id) REFERENCES core.wordnet_synset(lexicon, synset_id)

**Chỉ mục**:
- `wordnet_relation_target`: CREATE INDEX wordnet_relation_target ON core.wordnet_relation USING btree (lexicon, target_synset_id, rel_type)

<a id="corewordnet_synset"></a>
### `core.wordnet_synset`

*table — 295,473 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `lexicon` | text | không |  |  |
| 2 | `synset_id` | text | không |  |  |
| 3 | `concept_id` | bigint | không |  |  |
| 4 | `source_id` | integer | không |  |  |
| 5 | `batch_id` | uuid | không |  |  |

**Khoá chính**: `PRIMARY KEY (lexicon, synset_id)`

**Khoá ngoại**:
- `wordnet_synset_batch_id_fkey`: FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id)
- `wordnet_synset_concept_id_fkey`: FOREIGN KEY (concept_id) REFERENCES core.concept(id)
- `wordnet_synset_source_id_fkey`: FOREIGN KEY (source_id) REFERENCES source(id)

**Chỉ mục**:
- `wordnet_synset_concept`: CREATE INDEX wordnet_synset_concept ON core.wordnet_synset USING btree (concept_id)

## Schema `app`

*Dữ liệu người học (write-heavy): auth, collection, SRS, phiên ôn, AI, gamification.*

<a id="appadmin_audit_log"></a>
### `app.admin_audit_log`

*table — 0 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | bigint | không | identity |  |
| 2 | `admin_user_id` | bigint | không |  |  |
| 3 | `action` | text | không |  |  |
| 4 | `target_kind` | text | có |  |  |
| 5 | `target_id` | text | có |  |  |
| 6 | `payload` | jsonb | không | '{}'::jsonb |  |
| 7 | `created_at` | timestamp with time zone | không | now() |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `admin_audit_log_admin_user_id_fkey`: FOREIGN KEY (admin_user_id) REFERENCES app.users(id) ON DELETE CASCADE

**Ràng buộc khác**:
- `admin_audit_log_action_check` (check): CHECK ((btrim(action) <> ''::text))
- `admin_audit_log_payload_check` (check): CHECK ((jsonb_typeof(payload) = 'object'::text))

**Chỉ mục**:
- `admin_audit_recent`: CREATE INDEX admin_audit_recent ON app.admin_audit_log USING btree (created_at DESC)

<a id="appai_usage"></a>
### `app.ai_usage`

*table — 1 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `user_id` | bigint | không |  |  |
| 2 | `period` | date | không |  |  |
| 3 | `feature` | text | không |  |  |
| 4 | `request_count` | integer | không | 0 |  |
| 5 | `tokens_in` | bigint | không | 0 |  |
| 6 | `tokens_out` | bigint | không | 0 |  |
| 7 | `cost_usd` | numeric(12,6) | không | 0 |  |

**Khoá chính**: `PRIMARY KEY (user_id, period, feature)`

**Khoá ngoại**:
- `ai_usage_user_id_fkey`: FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE

**Ràng buộc khác**:
- `ai_usage_cost_usd_check` (check): CHECK ((cost_usd >= (0)::numeric))
- `ai_usage_feature_check` (check): CHECK ((feature = ANY (ARRAY['chat'::text, 'quiz'::text, 'embedding'::text, 'other'::text])))
- `ai_usage_request_count_check` (check): CHECK ((request_count >= 0))
- `ai_usage_tokens_in_check` (check): CHECK ((tokens_in >= 0))
- `ai_usage_tokens_out_check` (check): CHECK ((tokens_out >= 0))

<a id="appchat_message"></a>
### `app.chat_message`

*table — 4 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | bigint | không | identity |  |
| 2 | `session_id` | uuid | không |  |  |
| 3 | `role` | text | không |  |  |
| 4 | `content` | text | không |  |  |
| 5 | `content_json` | jsonb | không | '{}'::jsonb |  |
| 6 | `ref_sense_id` | bigint | có |  |  |
| 7 | `tokens_in` | integer | có |  |  |
| 8 | `tokens_out` | integer | có |  |  |
| 9 | `cost_usd` | numeric(10,6) | có |  |  |
| 10 | `model` | text | có |  |  |
| 11 | `created_at` | timestamp with time zone | không | now() |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `chat_message_ref_sense_id_fkey`: FOREIGN KEY (ref_sense_id) REFERENCES core.sense(id) ON DELETE SET NULL
- `chat_message_session_id_fkey`: FOREIGN KEY (session_id) REFERENCES app.chat_session(id) ON DELETE CASCADE

**Ràng buộc khác**:
- `chat_message_content_check` (check): CHECK ((btrim(content) <> ''::text))
- `chat_message_content_json_check` (check): CHECK ((jsonb_typeof(content_json) = 'object'::text))
- `chat_message_cost_usd_check` (check): CHECK ((cost_usd >= (0)::numeric))
- `chat_message_role_check` (check): CHECK ((role = ANY (ARRAY['system'::text, 'user'::text, 'assistant'::text, 'tool'::text])))
- `chat_message_tokens_in_check` (check): CHECK ((tokens_in >= 0))
- `chat_message_tokens_out_check` (check): CHECK ((tokens_out >= 0))

**Chỉ mục**:
- `chat_message_by_session`: CREATE INDEX chat_message_by_session ON app.chat_message USING btree (session_id, created_at)

<a id="appchat_session"></a>
### `app.chat_session`

*table — 1 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | uuid | không | gen_random_uuid() |  |
| 2 | `user_id` | bigint | không |  |  |
| 3 | `profile_id` | uuid | có |  |  |
| 4 | `language_id` | smallint | không |  |  |
| 5 | `scenario` | text | có |  |  |
| 6 | `title` | text | có |  |  |
| 7 | `model` | text | có |  |  |
| 8 | `prompt_version` | text | có |  |  |
| 9 | `summary` | text | có |  |  |
| 10 | `message_count` | integer | không | 0 |  |
| 11 | `last_message_at` | timestamp with time zone | có |  |  |
| 12 | `created_at` | timestamp with time zone | không | now() |  |
| 13 | `archived_at` | timestamp with time zone | có |  |  |
| 14 | `pending_request_id` | uuid | có |  |  |
| 15 | `pending_request_expires_at` | timestamp with time zone | có |  |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `chat_session_language_id_fkey`: FOREIGN KEY (language_id) REFERENCES language(id)
- `chat_session_profile_id_fkey`: FOREIGN KEY (profile_id) REFERENCES app.study_profile(id) ON DELETE SET NULL
- `chat_session_user_id_fkey`: FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE

**Ràng buộc khác**:
- `chat_session_message_count_check` (check): CHECK ((message_count >= 0))
- `chat_session_request_lease_pair` (check): CHECK (((pending_request_id IS NULL) = (pending_request_expires_at IS NULL)))

**Chỉ mục**:
- `chat_session_by_user`: CREATE INDEX chat_session_by_user ON app.chat_session USING btree (user_id, last_message_at DESC NULLS LAST)

<a id="appcollection"></a>
### `app.collection`

*table — 1 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | uuid | không | gen_random_uuid() |  |
| 2 | `profile_id` | uuid | không |  |  |
| 3 | `owner_id` | bigint | không |  |  |
| 4 | `name` | text | không |  |  |
| 5 | `description` | text | có |  |  |
| 6 | `kind` | text | không | 'personal'::text |  |
| 7 | `cloned_from_deck_id` | bigint | có |  |  |
| 8 | `cloned_from_collection_id` | uuid | có |  |  |
| 9 | `is_public` | boolean | không | false |  |
| 10 | `item_count` | integer | không | 0 |  |
| 11 | `created_at` | timestamp with time zone | không | now() |  |
| 12 | `updated_at` | timestamp with time zone | không | now() |  |
| 13 | `archived_at` | timestamp with time zone | có |  |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `collection_cloned_deck_fk`: FOREIGN KEY (cloned_from_deck_id) REFERENCES core.deck(id) ON DELETE SET NULL
- `collection_cloned_from_collection_id_fkey`: FOREIGN KEY (cloned_from_collection_id) REFERENCES app.collection(id) ON DELETE SET NULL
- `collection_owner_id_fkey`: FOREIGN KEY (owner_id) REFERENCES app.users(id) ON DELETE CASCADE
- `collection_profile_id_fkey`: FOREIGN KEY (profile_id) REFERENCES app.study_profile(id) ON DELETE CASCADE

**Ràng buộc khác**:
- `collection_item_count_check` (check): CHECK ((item_count >= 0))
- `collection_kind_check` (check): CHECK ((kind = ANY (ARRAY['personal'::text, 'cloned'::text, 'shared'::text])))
- `collection_name_check` (check): CHECK ((btrim(name) <> ''::text))

**Chỉ mục**:
- `collection_by_profile`: CREATE INDEX collection_by_profile ON app.collection USING btree (profile_id, archived_at, updated_at DESC)
- `collection_public`: CREATE INDEX collection_public ON app.collection USING btree (is_public) WHERE is_public

<a id="appcollection_item"></a>
### `app.collection_item`

*table — 12 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | uuid | không | gen_random_uuid() |  |
| 2 | `collection_id` | uuid | không |  |  |
| 3 | `concept_id` | bigint | có |  |  |
| 4 | `anchor_sense_id` | bigint | không |  |  |
| 5 | `meaning_vi` | text | không |  |  |
| 6 | `meaning_source` | text | không | 'user'::text |  |
| 7 | `note` | text | có |  |  |
| 8 | `status` | text | không | 'learning'::text |  |
| 9 | `position` | integer | không | 1 |  |
| 10 | `added_from_deck_id` | bigint | có |  |  |
| 11 | `created_at` | timestamp with time zone | không | now() |  |
| 12 | `updated_at` | timestamp with time zone | không | now() |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `collection_item_anchor_sense_id_fkey`: FOREIGN KEY (anchor_sense_id) REFERENCES core.sense(id) ON DELETE RESTRICT
- `collection_item_collection_id_fkey`: FOREIGN KEY (collection_id) REFERENCES app.collection(id) ON DELETE CASCADE
- `collection_item_concept_id_fkey`: FOREIGN KEY (concept_id) REFERENCES core.concept(id) ON DELETE RESTRICT
- `collection_item_deck_fk`: FOREIGN KEY (added_from_deck_id) REFERENCES core.deck(id) ON DELETE SET NULL

**Ràng buộc khác**:
- `collection_item_meaning_source_check` (check): CHECK ((meaning_source = ANY (ARRAY['user'::text, 'source'::text, 'machine'::text, 'llm'::text])))
- `collection_item_meaning_vi_check` (check): CHECK ((btrim(meaning_vi) <> ''::text))
- `collection_item_position_check` (check): CHECK (("position" > 0))
- `collection_item_status_check` (check): CHECK ((status = ANY (ARRAY['learning'::text, 'paused'::text, 'known'::text])))
- `collection_item_collection_id_anchor_sense_id_key` (unique): UNIQUE (collection_id, anchor_sense_id)

**Chỉ mục**:
- `collection_item_by_collection`: CREATE INDEX collection_item_by_collection ON app.collection_item USING btree (collection_id, "position")
- `collection_item_by_concept`: CREATE INDEX collection_item_by_concept ON app.collection_item USING btree (concept_id) WHERE (concept_id IS NOT NULL)

<a id="appcollection_item_face"></a>
### `app.collection_item_face`

*table — 12 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | uuid | không | gen_random_uuid() |  |
| 2 | `item_id` | uuid | không |  |  |
| 3 | `sense_id` | bigint | không |  |  |
| 4 | `language_id` | smallint | không |  |  |
| 5 | `role` | text | không | 'primary'::text |  |
| 6 | `created_at` | timestamp with time zone | không | now() |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `collection_item_face_item_id_fkey`: FOREIGN KEY (item_id) REFERENCES app.collection_item(id) ON DELETE CASCADE
- `collection_item_face_language_id_fkey`: FOREIGN KEY (language_id) REFERENCES language(id)
- `collection_item_face_sense_id_fkey`: FOREIGN KEY (sense_id) REFERENCES core.sense(id) ON DELETE RESTRICT

**Ràng buộc khác**:
- `collection_item_face_role_check` (check): CHECK ((role = ANY (ARRAY['primary'::text, 'secondary'::text])))
- `collection_item_face_item_id_language_id_key` (unique): UNIQUE (item_id, language_id)
- `collection_item_face_item_id_sense_id_key` (unique): UNIQUE (item_id, sense_id)

**Chỉ mục**:
- `item_face_by_sense`: CREATE INDEX item_face_by_sense ON app.collection_item_face USING btree (sense_id)

<a id="appcollection_item_tag"></a>
### `app.collection_item_tag`

*table — 5 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `item_id` | uuid | không |  |  |
| 2 | `tag_id` | bigint | không |  |  |

**Khoá chính**: `PRIMARY KEY (item_id, tag_id)`

**Khoá ngoại**:
- `collection_item_tag_item_id_fkey`: FOREIGN KEY (item_id) REFERENCES app.collection_item(id) ON DELETE CASCADE
- `collection_item_tag_tag_id_fkey`: FOREIGN KEY (tag_id) REFERENCES app.tag(id) ON DELETE CASCADE

**Chỉ mục**:
- `item_tag_by_tag`: CREATE INDEX item_tag_by_tag ON app.collection_item_tag USING btree (tag_id, item_id)

<a id="appcollection_share"></a>
### `app.collection_share`

*table — 1 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | uuid | không | gen_random_uuid() |  |
| 2 | `collection_id` | uuid | không |  |  |
| 3 | `token` | text | không |  |  |
| 4 | `permission` | text | không | 'view'::text |  |
| 5 | `created_by` | bigint | không |  |  |
| 6 | `expires_at` | timestamp with time zone | có |  |  |
| 7 | `revoked_at` | timestamp with time zone | có |  |  |
| 8 | `created_at` | timestamp with time zone | không | now() |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `collection_share_collection_id_fkey`: FOREIGN KEY (collection_id) REFERENCES app.collection(id) ON DELETE CASCADE
- `collection_share_created_by_fkey`: FOREIGN KEY (created_by) REFERENCES app.users(id) ON DELETE CASCADE

**Ràng buộc khác**:
- `collection_share_permission_check` (check): CHECK ((permission = ANY (ARRAY['view'::text, 'clone'::text])))
- `collection_share_token_check` (check): CHECK ((btrim(token) <> ''::text))
- `collection_share_token_key` (unique): UNIQUE (token)

**Chỉ mục**:
- `collection_share_by_collection`: CREATE INDEX collection_share_by_collection ON app.collection_share USING btree (collection_id) WHERE (revoked_at IS NULL)

<a id="appdevice"></a>
### `app.device`

*table — 2 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | uuid | không | gen_random_uuid() |  |
| 2 | `user_id` | bigint | không |  |  |
| 3 | `platform` | text | không |  |  |
| 4 | `push_provider` | text | có |  |  |
| 5 | `push_token` | text | có |  |  |
| 6 | `app_version` | text | có |  |  |
| 7 | `last_seen_at` | timestamp with time zone | có |  |  |
| 8 | `created_at` | timestamp with time zone | không | now() |  |
| 9 | `revoked_at` | timestamp with time zone | có |  |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `device_user_id_fkey`: FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE

**Ràng buộc khác**:
- `device_platform_check` (check): CHECK ((platform = ANY (ARRAY['ios'::text, 'android'::text, 'web'::text])))
- `device_push_pair` (check): CHECK ((((push_provider IS NULL) AND (push_token IS NULL)) OR ((push_provider IS NOT NULL) AND (push_token IS NOT NULL))))
- `device_push_provider_check` (check): CHECK ((push_provider = ANY (ARRAY['fcm'::text, 'apns'::text, 'webpush'::text])))

**Chỉ mục**:
- `device_by_user`: CREATE INDEX device_by_user ON app.device USING btree (user_id)
- `device_push_unique`: CREATE UNIQUE INDEX device_push_unique ON app.device USING btree (push_provider, push_token) WHERE ((push_token IS NOT NULL) AND (revoked_at IS NULL))

<a id="appfeedback"></a>
### `app.feedback`

*table — 0 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | uuid | không |  |  |
| 2 | `user_id` | bigint | không |  |  |
| 3 | `category` | text | không |  |  |
| 4 | `content` | text | không |  |  |
| 5 | `status` | text | không | 'new'::text |  |
| 6 | `admin_note` | text | có |  |  |
| 7 | `created_at` | timestamp with time zone | không | now() |  |
| 8 | `updated_at` | timestamp with time zone | không | now() |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `feedback_user_id_fkey`: FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE

**Ràng buộc khác**:
- `feedback_category_check` (check): CHECK ((category = ANY (ARRAY['bug'::text, 'feature'::text, 'content'::text, 'other'::text])))
- `feedback_content_check` (check): CHECK ((btrim(content) <> ''::text))
- `feedback_status_check` (check): CHECK ((status = ANY (ARRAY['new'::text, 'in_progress'::text, 'resolved'::text])))

**Chỉ mục**:
- `feedback_queue`: CREATE INDEX feedback_queue ON app.feedback USING btree (status, created_at)

<a id="appfeedback_attachment"></a>
### `app.feedback_attachment`

*table — 0 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | uuid | không |  |  |
| 2 | `feedback_id` | uuid | không |  |  |
| 3 | `storage_key` | text | không |  |  |
| 4 | `mime` | text | không |  |  |
| 5 | `size_bytes` | integer | không |  |  |
| 6 | `created_at` | timestamp with time zone | không | now() |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `feedback_attachment_feedback_id_fkey`: FOREIGN KEY (feedback_id) REFERENCES app.feedback(id) ON DELETE CASCADE

**Ràng buộc khác**:
- `feedback_attachment_mime_check` (check): CHECK ((mime = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'image/webp'::text])))
- `feedback_attachment_size_bytes_check` (check): CHECK ((size_bytes > 0))
- `feedback_attachment_storage_key_check` (check): CHECK ((btrim(storage_key) <> ''::text))

**Chỉ mục**:
- `feedback_attachment_by_feedback`: CREATE INDEX feedback_attachment_by_feedback ON app.feedback_attachment USING btree (feedback_id)

<a id="appgloss_report"></a>
### `app.gloss_report`

*table — 0 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | bigint | không | identity |  |
| 2 | `user_id` | bigint | có |  |  |
| 3 | `target_kind` | text | không |  |  |
| 4 | `target_id` | text | không |  |  |
| 5 | `language_id` | smallint | có |  |  |
| 6 | `issue` | text | không |  |  |
| 7 | `comment` | text | có |  |  |
| 8 | `status` | text | không | 'open'::text |  |
| 9 | `created_at` | timestamp with time zone | không | now() |  |
| 10 | `resolved_at` | timestamp with time zone | có |  |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `gloss_report_language_id_fkey`: FOREIGN KEY (language_id) REFERENCES language(id)
- `gloss_report_user_id_fkey`: FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE SET NULL

**Ràng buộc khác**:
- `gloss_report_issue_check` (check): CHECK ((issue = ANY (ARRAY['wrong'::text, 'missing'::text, 'offensive'::text, 'other'::text])))
- `gloss_report_resolved_pair` (check): CHECK (((status = ANY (ARRAY['fixed'::text, 'rejected'::text])) = (resolved_at IS NOT NULL)))
- `gloss_report_status_check` (check): CHECK ((status = ANY (ARRAY['open'::text, 'triaged'::text, 'fixed'::text, 'rejected'::text])))
- `gloss_report_target_id_check` (check): CHECK ((btrim(target_id) <> ''::text))
- `gloss_report_target_kind_check` (check): CHECK ((target_kind = ANY (ARRAY['sense_gloss'::text, 'concept_gloss'::text, 'example'::text, 'translation'::text])))

**Chỉ mục**:
- `gloss_report_gloss`: CREATE INDEX gloss_report_gloss ON app.gloss_report USING btree (target_kind, target_id)
- `gloss_report_queue`: CREATE INDEX gloss_report_queue ON app.gloss_report USING btree (status, created_at)

<a id="appgoogle_oauth_challenge"></a>
### `app.google_oauth_challenge`

*table — 0 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | uuid | không |  |  |
| 2 | `purpose` | text | không |  |  |
| 3 | `user_id` | bigint | có |  |  |
| 4 | `session_id` | uuid | có |  |  |
| 5 | `nonce_hash` | text | không |  |  |
| 6 | `binding_hash` | text | không |  |  |
| 7 | `expires_at` | timestamp with time zone | không |  |  |
| 8 | `consumed_at` | timestamp with time zone | có |  |  |
| 9 | `created_at` | timestamp with time zone | không | now() |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `google_oauth_challenge_session_id_fkey`: FOREIGN KEY (session_id) REFERENCES app.user_session(id) ON DELETE CASCADE
- `google_oauth_challenge_user_id_fkey`: FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE

**Ràng buộc khác**:
- `google_oauth_challenge_binding_hash_check` (check): CHECK ((btrim(binding_hash) <> ''::text))
- `google_oauth_challenge_link_context` (check): CHECK ((((purpose = 'login'::text) AND (user_id IS NULL) AND (session_id IS NULL)) OR ((purpose = 'link'::text) AND (user_id IS NOT NULL) AND (session_id IS NOT NULL))))
- `google_oauth_challenge_nonce_hash_check` (check): CHECK ((btrim(nonce_hash) <> ''::text))
- `google_oauth_challenge_purpose_check` (check): CHECK ((purpose = ANY (ARRAY['login'::text, 'link'::text])))

**Chỉ mục**:
- `google_oauth_challenge_live`: CREATE INDEX google_oauth_challenge_live ON app.google_oauth_challenge USING btree (purpose, expires_at) WHERE (consumed_at IS NULL)
- `google_oauth_challenge_user_live`: CREATE INDEX google_oauth_challenge_user_live ON app.google_oauth_challenge USING btree (user_id, expires_at) WHERE ((consumed_at IS NULL) AND (user_id IS NOT NULL))

<a id="appnotification_log"></a>
### `app.notification_log`

*table — 0 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | bigint | không | identity |  |
| 2 | `user_id` | bigint | không |  |  |
| 3 | `reminder_id` | uuid | có |  |  |
| 4 | `channel` | text | không |  |  |
| 5 | `title` | text | có |  |  |
| 6 | `body` | text | có |  |  |
| 7 | `payload` | jsonb | không | '{}'::jsonb |  |
| 8 | `provider_message_id` | text | có |  |  |
| 9 | `status` | text | không | 'queued'::text |  |
| 10 | `error` | text | có |  |  |
| 11 | `idempotency_key` | text | có |  |  |
| 12 | `sent_at` | timestamp with time zone | có |  |  |
| 13 | `opened_at` | timestamp with time zone | có |  |  |
| 14 | `created_at` | timestamp with time zone | không | now() |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `notification_log_reminder_id_fkey`: FOREIGN KEY (reminder_id) REFERENCES app.reminder(id) ON DELETE SET NULL
- `notification_log_user_id_fkey`: FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE

**Ràng buộc khác**:
- `notification_log_channel_check` (check): CHECK ((channel = ANY (ARRAY['push'::text, 'email'::text])))
- `notification_log_payload_check` (check): CHECK ((jsonb_typeof(payload) = 'object'::text))
- `notification_log_status_check` (check): CHECK ((status = ANY (ARRAY['queued'::text, 'sent'::text, 'failed'::text, 'opened'::text, 'clicked'::text])))
- `notification_queued_has_no_sent_at` (check): CHECK (((sent_at IS NULL) OR (status <> 'queued'::text)))

**Chỉ mục**:
- `notification_log_by_user`: CREATE INDEX notification_log_by_user ON app.notification_log USING btree (user_id, created_at DESC)
- `notification_log_idempotent`: CREATE UNIQUE INDEX notification_log_idempotent ON app.notification_log USING btree (reminder_id, idempotency_key) WHERE ((reminder_id IS NOT NULL) AND (idempotency_key IS NOT NULL))

<a id="appquiz"></a>
### `app.quiz`

*table — 1 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | uuid | không | gen_random_uuid() |  |
| 2 | `user_id` | bigint | không |  |  |
| 3 | `profile_id` | uuid | không |  |  |
| 4 | `collection_id` | uuid | có |  |  |
| 5 | `quiz_type` | text | không |  |  |
| 6 | `difficulty` | text | không |  |  |
| 7 | `question_count` | smallint | không |  |  |
| 8 | `generator` | jsonb | không | '{}'::jsonb |  |
| 9 | `status` | text | không | 'ready'::text |  |
| 10 | `created_at` | timestamp with time zone | không | now() |  |
| 11 | `expires_at` | timestamp with time zone | có |  |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `quiz_collection_id_fkey`: FOREIGN KEY (collection_id) REFERENCES app.collection(id) ON DELETE SET NULL
- `quiz_profile_id_fkey`: FOREIGN KEY (profile_id) REFERENCES app.study_profile(id) ON DELETE CASCADE
- `quiz_user_id_fkey`: FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE

**Ràng buộc khác**:
- `quiz_difficulty_check` (check): CHECK ((difficulty = ANY (ARRAY['easy'::text, 'medium'::text, 'hard'::text])))
- `quiz_generator_check` (check): CHECK ((jsonb_typeof(generator) = 'object'::text))
- `quiz_question_count_check` (check): CHECK (((question_count >= 1) AND (question_count <= 50)))
- `quiz_quiz_type_check` (check): CHECK ((quiz_type = ANY (ARRAY['multiple_choice'::text, 'fill_blank'::text, 'matching'::text, 'mixed'::text])))
- `quiz_status_check` (check): CHECK ((status = ANY (ARRAY['generating'::text, 'ready'::text, 'failed'::text, 'expired'::text])))

**Chỉ mục**:
- `quiz_by_user`: CREATE INDEX quiz_by_user ON app.quiz USING btree (user_id, created_at DESC)

<a id="appquiz_question"></a>
### `app.quiz_question`

*table — 3 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | bigint | không | identity |  |
| 2 | `quiz_id` | uuid | không |  |  |
| 3 | `ordinal` | smallint | không |  |  |
| 4 | `question_type` | text | không |  |  |
| 5 | `prompt` | text | không |  |  |
| 6 | `options` | jsonb | không | '[]'::jsonb |  |
| 7 | `correct_answer` | jsonb | không |  |  |
| 8 | `explanation` | text | có |  |  |
| 9 | `language_id` | smallint | có |  |  |
| 10 | `concept_id` | bigint | có |  |  |
| 11 | `item_id` | uuid | có |  |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `quiz_question_concept_id_fkey`: FOREIGN KEY (concept_id) REFERENCES core.concept(id) ON DELETE SET NULL
- `quiz_question_item_id_fkey`: FOREIGN KEY (item_id) REFERENCES app.collection_item(id) ON DELETE SET NULL
- `quiz_question_language_id_fkey`: FOREIGN KEY (language_id) REFERENCES language(id)
- `quiz_question_quiz_id_fkey`: FOREIGN KEY (quiz_id) REFERENCES app.quiz(id) ON DELETE CASCADE

**Ràng buộc khác**:
- `quiz_question_options_check` (check): CHECK ((jsonb_typeof(options) = 'array'::text))
- `quiz_question_ordinal_check` (check): CHECK ((ordinal > 0))
- `quiz_question_prompt_check` (check): CHECK ((btrim(prompt) <> ''::text))
- `quiz_question_question_type_check` (check): CHECK ((question_type = ANY (ARRAY['multiple_choice'::text, 'fill_blank'::text, 'matching'::text])))
- `quiz_question_quiz_id_ordinal_key` (unique): UNIQUE (quiz_id, ordinal)

<a id="appreminder"></a>
### `app.reminder`

*table — 1 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | uuid | không | gen_random_uuid() |  |
| 2 | `user_id` | bigint | không |  |  |
| 3 | `label` | text | có |  |  |
| 4 | `time_of_day` | time without time zone | không |  |  |
| 5 | `timezone` | text | không |  |  |
| 6 | `weekdays` | smallint[] | không | '{1,2,3,4,5,6,7}'::smallint[] |  |
| 7 | `channels` | text[] | không | '{push}'::text[] |  |
| 8 | `is_enabled` | boolean | không | true |  |
| 9 | `smart_reminder` | boolean | không | false |  |
| 10 | `missed_days_threshold` | smallint | không | 2 |  |
| 11 | `next_fire_at` | timestamp with time zone | có |  |  |
| 12 | `created_at` | timestamp with time zone | không | now() |  |
| 13 | `updated_at` | timestamp with time zone | không | now() |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `reminder_user_id_fkey`: FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE

**Ràng buộc khác**:
- `reminder_channels_check` (check): CHECK ((channels <@ ARRAY['push'::text, 'email'::text]))
- `reminder_missed_days_threshold_check` (check): CHECK (((missed_days_threshold >= 1) AND (missed_days_threshold <= 30)))
- `reminder_weekdays_check` (check): CHECK ((weekdays <@ ARRAY[(1)::smallint, (2)::smallint, (3)::smallint, (4)::smallint, (5)::smallint, (6)::smallint, (7)::smallint]))

**Chỉ mục**:
- `reminder_by_user`: CREATE INDEX reminder_by_user ON app.reminder USING btree (user_id)
- `reminder_due`: CREATE INDEX reminder_due ON app.reminder USING btree (next_fire_at) WHERE (is_enabled AND (next_fire_at IS NOT NULL))

<a id="appreview_log"></a>
### `app.review_log`

*partitioned table — 24 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | bigint | không | identity |  |
| 2 | `srs_id` | bigint | có |  |  |
| 3 | `user_id` | bigint | không |  |  |
| 4 | `face_id` | uuid | không |  |  |
| 5 | `rating` | smallint | không |  |  |
| 6 | `mode` | text | không | 'flashcard'::text |  |
| 7 | `elapsed_ms` | integer | có |  |  |
| 8 | `reviewed_at` | timestamp with time zone | không | now() |  |
| 9 | `client_review_id` | uuid | có |  |  |
| 10 | `prev_state` | text | có |  |  |
| 11 | `profile_id` | uuid | có |  |  |
| 12 | `queue_kind_before` | text | có |  |  |

**Khoá chính**: `PRIMARY KEY (id, reviewed_at)`

**Khoá ngoại**:
- `review_log_profile_id_fkey`: FOREIGN KEY (profile_id) REFERENCES app.study_profile(id) ON DELETE SET NULL
- `review_log_srs_id_fkey`: FOREIGN KEY (srs_id) REFERENCES app.srs_state(id) ON DELETE SET NULL
- `review_log_user_id_fkey`: FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE

**Ràng buộc khác**:
- `review_log_elapsed_ms_check` (check): CHECK ((elapsed_ms >= 0))
- `review_log_mode_check` (check): CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text])))
- `review_log_prev_state_check` (check): CHECK (((prev_state IS NULL) OR (prev_state = ANY (ARRAY['new'::text, 'learning'::text, 'review'::text, 'relearning'::text]))))
- `review_log_queue_kind_check` (check): CHECK (((queue_kind_before IS NULL) OR (queue_kind_before = ANY (ARRAY['new'::text, 'intraday_learning'::text, 'interday_learning'::text, 'review'::text]))))
- `review_log_rating_check` (check): CHECK (((rating >= 1) AND (rating <= 4)))

**Chỉ mục**:
- `review_log_by_user`: CREATE INDEX review_log_by_user ON ONLY app.review_log USING btree (user_id, reviewed_at DESC)
- `review_log_client_review`: CREATE INDEX review_log_client_review ON ONLY app.review_log USING btree (user_id, client_review_id) WHERE (client_review_id IS NOT NULL)
- `review_log_user_profile_time`: CREATE INDEX review_log_user_profile_time ON ONLY app.review_log USING btree (user_id, profile_id, reviewed_at DESC)

**Partition** (36): `review_log_2026_09`, `review_log_2026_10`, `review_log_2026_11`, `review_log_2026_12`, `review_log_2027_01`, `review_log_2027_02`, `review_log_2027_03`, `review_log_2027_04` … (+28)

<a id="appsearch_history"></a>
### `app.search_history`

*table — 3 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | bigint | không | identity |  |
| 2 | `user_id` | bigint | không |  |  |
| 3 | `raw_query` | text | không |  |  |
| 4 | `normalized` | text | có |  |  |
| 5 | `language_id` | smallint | có |  |  |
| 6 | `matched_sense_id` | bigint | có |  |  |
| 7 | `result_count` | integer | có |  |  |
| 8 | `created_at` | timestamp with time zone | không | now() |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `search_history_language_id_fkey`: FOREIGN KEY (language_id) REFERENCES language(id)
- `search_history_matched_sense_id_fkey`: FOREIGN KEY (matched_sense_id) REFERENCES core.sense(id) ON DELETE SET NULL
- `search_history_user_id_fkey`: FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE

**Ràng buộc khác**:
- `search_history_raw_query_check` (check): CHECK ((btrim(raw_query) <> ''::text))
- `search_history_result_count_check` (check): CHECK ((result_count >= 0))

**Chỉ mục**:
- `search_history_recent`: CREATE INDEX search_history_recent ON app.search_history USING btree (user_id, created_at DESC)

<a id="appsrs_review_receipt"></a>
### `app.srs_review_receipt`

*table — 0 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `user_id` | bigint | không |  |  |
| 2 | `client_review_id` | uuid | không |  |  |
| 3 | `request_payload` | jsonb | không |  |  |
| 4 | `response_payload` | jsonb | không |  |  |
| 5 | `created_at` | timestamp with time zone | không | now() |  |

**Khoá chính**: `PRIMARY KEY (user_id, client_review_id)`

**Khoá ngoại**:
- `srs_review_receipt_user_id_fkey`: FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE

**Ràng buộc khác**:
- `srs_review_receipt_request_payload_check` (check): CHECK ((jsonb_typeof(request_payload) = 'object'::text))
- `srs_review_receipt_response_payload_check` (check): CHECK ((jsonb_typeof(response_payload) = 'object'::text))

<a id="appsrs_state"></a>
### `app.srs_state`

*table — 24 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | bigint | không | identity |  |
| 2 | `face_id` | uuid | không |  |  |
| 3 | `user_id` | bigint | không |  |  |
| 4 | `profile_id` | uuid | không |  |  |
| 6 | `state` | text | không | 'new'::text |  |
| 7 | `due_at` | timestamp with time zone | không | now() |  |
| 8 | `stability` | real | có |  |  |
| 9 | `difficulty` | real | có |  |  |
| 10 | `reps` | integer | không | 0 |  |
| 11 | `lapses` | integer | không | 0 |  |
| 12 | `scheduled_days` | integer | có |  |  |
| 13 | `elapsed_days` | integer | có |  |  |
| 14 | `last_review_at` | timestamp with time zone | có |  |  |
| 15 | `suspended` | boolean | không | false |  |
| 16 | `created_at` | timestamp with time zone | không | now() |  |
| 17 | `updated_at` | timestamp with time zone | không | now() |  |
| 18 | `ease_factor` | double precision | không | 2.5 |  |
| 19 | `learning_step` | smallint | có |  |  |
| 20 | `introduced_at` | timestamp with time zone | có |  |  |
| 21 | `buried_until` | timestamp with time zone | có |  |  |
| 22 | `learning_is_interday` | boolean | không | false |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `srs_state_face_id_fkey`: FOREIGN KEY (face_id) REFERENCES app.collection_item_face(id) ON DELETE CASCADE
- `srs_state_profile_id_fkey`: FOREIGN KEY (profile_id) REFERENCES app.study_profile(id) ON DELETE CASCADE
- `srs_state_user_id_fkey`: FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE

**Ràng buộc khác**:
- `srs_state_difficulty_check` (check): CHECK ((difficulty > (0)::double precision))
- `srs_state_ease_factor_check` (check): CHECK ((ease_factor >= (1.3)::double precision))
- `srs_state_elapsed_days_check` (check): CHECK ((elapsed_days >= 0))
- `srs_state_lapses_check` (check): CHECK ((lapses >= 0))
- `srs_state_learning_step_check` (check): CHECK (((learning_step IS NULL) OR (learning_step >= 0)))
- `srs_state_reps_check` (check): CHECK ((reps >= 0))
- `srs_state_scheduled_days_check` (check): CHECK ((scheduled_days >= 0))
- `srs_state_stability_check` (check): CHECK ((stability > (0)::double precision))
- `srs_state_state_check` (check): CHECK ((state = ANY (ARRAY['new'::text, 'learning'::text, 'review'::text, 'relearning'::text])))
- `srs_state_face_id_key` (unique): UNIQUE (face_id)

**Chỉ mục**:
- `srs_due_by_profile`: CREATE INDEX srs_due_by_profile ON app.srs_state USING btree (profile_id, due_at) WHERE (NOT suspended)
- `srs_due_by_user`: CREATE INDEX srs_due_by_user ON app.srs_state USING btree (user_id, due_at) WHERE (NOT suspended)

<a id="appstreak_day"></a>
### `app.streak_day`

*table — 5 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `user_id` | bigint | không |  |  |
| 2 | `day` | date | không |  |  |
| 3 | `review_count` | integer | không | 0 |  |
| 5 | `met_goal` | boolean | không | false |  |

**Khoá chính**: `PRIMARY KEY (user_id, day)`

**Khoá ngoại**:
- `streak_day_user_id_fkey`: FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE

**Ràng buộc khác**:
- `streak_day_review_count_check` (check): CHECK ((review_count >= 0))

**Chỉ mục**:
- `streak_day_recent`: CREATE INDEX streak_day_recent ON app.streak_day USING btree (user_id, day DESC)

<a id="appstudy_profile"></a>
### `app.study_profile`

*table — 1 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | uuid | không | gen_random_uuid() |  |
| 2 | `user_id` | bigint | không |  |  |
| 3 | `name` | text | không |  |  |
| 4 | `primary_language_id` | smallint | không |  |  |
| 5 | `secondary_language_id` | smallint | có |  |  |
| 6 | `support_language_id` | smallint | không |  |  |
| 7 | `is_default` | boolean | không | false |  |
| 8 | `created_at` | timestamp with time zone | không | now() |  |
| 9 | `updated_at` | timestamp with time zone | không | now() |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `study_profile_primary_language_id_fkey`: FOREIGN KEY (primary_language_id) REFERENCES language(id)
- `study_profile_secondary_language_id_fkey`: FOREIGN KEY (secondary_language_id) REFERENCES language(id)
- `study_profile_support_language_id_fkey`: FOREIGN KEY (support_language_id) REFERENCES language(id)
- `study_profile_user_id_fkey`: FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE

**Ràng buộc khác**:
- `study_profile_languages_differ` (check): CHECK ((((secondary_language_id IS NULL) OR (secondary_language_id <> primary_language_id)) AND (support_language_id <> primary_language_id) AND ((secondary_language_id IS NULL) OR (support_language_id <> secondary_language_id))))
- `study_profile_name_check` (check): CHECK ((btrim(name) <> ''::text))

**Chỉ mục**:
- `study_profile_by_user`: CREATE INDEX study_profile_by_user ON app.study_profile USING btree (user_id)
- `study_profile_one_default`: CREATE UNIQUE INDEX study_profile_one_default ON app.study_profile USING btree (user_id) WHERE is_default

<a id="appstudy_session"></a>
### `app.study_session`

*table — 0 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | uuid | không | gen_random_uuid() |  |
| 2 | `user_id` | bigint | không |  |  |
| 3 | `profile_id` | uuid | không |  |  |
| 4 | `kind` | text | không |  |  |
| 5 | `mode` | text | không |  |  |
| 6 | `collection_id` | uuid | có |  |  |
| 7 | `quiz_id` | uuid | có |  |  |
| 8 | `settings` | jsonb | không | '{}'::jsonb |  |
| 9 | `status` | text | không | 'in_progress'::text |  |
| 10 | `item_count` | integer | không | 0 |  |
| 11 | `correct_count` | integer | không | 0 |  |
| 12 | `score` | integer | có |  |  |
| 14 | `started_at` | timestamp with time zone | không | now() |  |
| 15 | `finished_at` | timestamp with time zone | có |  |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `study_session_collection_id_fkey`: FOREIGN KEY (collection_id) REFERENCES app.collection(id) ON DELETE SET NULL
- `study_session_profile_id_fkey`: FOREIGN KEY (profile_id) REFERENCES app.study_profile(id) ON DELETE CASCADE
- `study_session_quiz_fk`: FOREIGN KEY (quiz_id) REFERENCES app.quiz(id) ON DELETE SET NULL
- `study_session_user_id_fkey`: FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE

**Ràng buộc khác**:
- `study_session_correct_count_check` (check): CHECK ((correct_count >= 0))
- `study_session_correct_le_items` (check): CHECK ((correct_count <= item_count))
- `study_session_item_count_check` (check): CHECK ((item_count >= 0))
- `study_session_kind_check` (check): CHECK ((kind = ANY (ARRAY['review'::text, 'practice'::text, 'quiz'::text])))
- `study_session_mode_check` (check): CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text])))
- `study_session_quiz_needs_quiz` (check): CHECK (((kind <> 'quiz'::text) OR (quiz_id IS NOT NULL)))
- `study_session_score_check` (check): CHECK (((score >= 0) AND (score <= 100)))
- `study_session_settings_check` (check): CHECK ((jsonb_typeof(settings) = 'object'::text))
- `study_session_status_check` (check): CHECK ((status = ANY (ARRAY['in_progress'::text, 'completed'::text, 'abandoned'::text])))

**Chỉ mục**:
- `study_session_by_profile`: CREATE INDEX study_session_by_profile ON app.study_session USING btree (profile_id, started_at DESC)
- `study_session_by_user`: CREATE INDEX study_session_by_user ON app.study_session USING btree (user_id, started_at DESC)
- `study_session_open`: CREATE INDEX study_session_open ON app.study_session USING btree (user_id) WHERE (status = 'in_progress'::text)

<a id="appstudy_session_item"></a>
### `app.study_session_item`

*table — 0 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | bigint | không | identity |  |
| 2 | `session_id` | uuid | không |  |  |
| 3 | `ordinal` | smallint | không |  |  |
| 4 | `srs_id` | bigint | có |  |  |
| 5 | `face_id` | uuid | có |  |  |
| 6 | `quiz_question_id` | bigint | có |  |  |
| 7 | `prompt` | jsonb | không | '{}'::jsonb |  |
| 8 | `correct_answer` | jsonb | có |  |  |
| 9 | `user_answer` | jsonb | có |  |  |
| 10 | `is_correct` | boolean | có |  |  |
| 11 | `rating` | smallint | có |  |  |
| 12 | `elapsed_ms` | integer | có |  |  |
| 13 | `answered_at` | timestamp with time zone | có |  |  |
| 14 | `answer_receipt` | jsonb | có |  |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `session_item_quiz_question_fk`: FOREIGN KEY (quiz_question_id) REFERENCES app.quiz_question(id) ON DELETE SET NULL
- `study_session_item_face_id_fkey`: FOREIGN KEY (face_id) REFERENCES app.collection_item_face(id) ON DELETE SET NULL
- `study_session_item_session_id_fkey`: FOREIGN KEY (session_id) REFERENCES app.study_session(id) ON DELETE CASCADE
- `study_session_item_srs_id_fkey`: FOREIGN KEY (srs_id) REFERENCES app.srs_state(id) ON DELETE SET NULL

**Ràng buộc khác**:
- `session_item_has_source` (check): CHECK (((srs_id IS NOT NULL) OR (quiz_question_id IS NOT NULL) OR (prompt <> '{}'::jsonb)))
- `study_session_item_answer_receipt_check` (check): CHECK (((answer_receipt IS NULL) OR (jsonb_typeof(answer_receipt) = 'object'::text)))
- `study_session_item_elapsed_ms_check` (check): CHECK ((elapsed_ms >= 0))
- `study_session_item_ordinal_check` (check): CHECK ((ordinal > 0))
- `study_session_item_prompt_check` (check): CHECK ((jsonb_typeof(prompt) = 'object'::text))
- `study_session_item_rating_check` (check): CHECK (((rating >= 1) AND (rating <= 4)))
- `study_session_item_session_id_ordinal_key` (unique): UNIQUE (session_id, ordinal)

**Chỉ mục**:
- `session_item_by_session`: CREATE INDEX session_item_by_session ON app.study_session_item USING btree (session_id, ordinal)
- `session_item_wrong`: CREATE INDEX session_item_wrong ON app.study_session_item USING btree (session_id) WHERE (is_correct IS FALSE)

<a id="apptag"></a>
### `app.tag`

*table — 2 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | bigint | không | identity |  |
| 2 | `user_id` | bigint | không |  |  |
| 3 | `name` | text | không |  |  |
| 4 | `color` | text | có |  |  |
| 5 | `created_at` | timestamp with time zone | không | now() |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `tag_user_id_fkey`: FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE

**Ràng buộc khác**:
- `tag_name_check` (check): CHECK ((btrim(name) <> ''::text))

**Chỉ mục**:
- `tag_user_name_unique`: CREATE UNIQUE INDEX tag_user_name_unique ON app.tag USING btree (user_id, lower(name))

<a id="appuser_identity"></a>
### `app.user_identity`

*table — 1 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | bigint | không | identity |  |
| 2 | `user_id` | bigint | không |  |  |
| 3 | `provider` | text | không |  |  |
| 4 | `provider_uid` | text | không |  |  |
| 5 | `password_hash` | text | có |  |  |
| 6 | `email_verified_at` | timestamp with time zone | có |  |  |
| 7 | `created_at` | timestamp with time zone | không | now() |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `user_identity_user_id_fkey`: FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE

**Ràng buộc khác**:
- `user_identity_password_shape` (check): CHECK ((((provider = 'password'::text) AND (password_hash IS NOT NULL)) OR ((provider <> 'password'::text) AND (password_hash IS NULL))))
- `user_identity_provider_check` (check): CHECK ((provider = ANY (ARRAY['password'::text, 'google'::text, 'apple'::text])))
- `user_identity_provider_uid_check` (check): CHECK ((btrim(provider_uid) <> ''::text))
- `user_identity_provider_provider_uid_key` (unique): UNIQUE (provider, provider_uid)

**Chỉ mục**:
- `user_identity_by_user`: CREATE INDEX user_identity_by_user ON app.user_identity USING btree (user_id)

<a id="appuser_session"></a>
### `app.user_session`

*table — 0 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | uuid | không | gen_random_uuid() |  |
| 2 | `user_id` | bigint | không |  |  |
| 3 | `device_id` | uuid | có |  |  |
| 4 | `refresh_token_hash` | text | không |  |  |
| 5 | `created_at` | timestamp with time zone | không | now() |  |
| 6 | `last_used_at` | timestamp with time zone | có |  |  |
| 7 | `expires_at` | timestamp with time zone | không |  |  |
| 8 | `revoked_at` | timestamp with time zone | có |  |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Khoá ngoại**:
- `user_session_device_id_fkey`: FOREIGN KEY (device_id) REFERENCES app.device(id) ON DELETE SET NULL
- `user_session_user_id_fkey`: FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE

**Ràng buộc khác**:
- `user_session_refresh_token_hash_check` (check): CHECK ((btrim(refresh_token_hash) <> ''::text))
- `user_session_refresh_token_hash_key` (unique): UNIQUE (refresh_token_hash)

**Chỉ mục**:
- `user_session_active`: CREATE INDEX user_session_active ON app.user_session USING btree (user_id, expires_at) WHERE (revoked_at IS NULL)

<a id="appuser_settings"></a>
### `app.user_settings`

*table — 1 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `user_id` | bigint | không |  |  |
| 2 | `timezone` | text | không | 'Asia/Ho_Chi_Minh'::text |  |
| 3 | `ui_language_id` | smallint | có |  |  |
| 4 | `daily_goal` | smallint | không | 20 |  |
| 5 | `notify` | jsonb | không | '{}'::jsonb |  |
| 6 | `active_profile_id` | uuid | có |  |  |
| 7 | `updated_at` | timestamp with time zone | không | now() |  |
| 8 | `srs_new_per_day` | smallint | không | 20 |  |
| 9 | `srs_review_per_day` | smallint | không | 200 |  |

**Khoá chính**: `PRIMARY KEY (user_id)`

**Khoá ngoại**:
- `user_settings_active_profile_id_fkey`: FOREIGN KEY (active_profile_id) REFERENCES app.study_profile(id) ON DELETE SET NULL
- `user_settings_ui_language_id_fkey`: FOREIGN KEY (ui_language_id) REFERENCES language(id)
- `user_settings_user_id_fkey`: FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE

**Ràng buộc khác**:
- `user_settings_daily_goal_check` (check): CHECK (((daily_goal >= 1) AND (daily_goal <= 500)))
- `user_settings_notify_check` (check): CHECK ((jsonb_typeof(notify) = 'object'::text))
- `user_settings_srs_new_per_day_check` (check): CHECK (((srs_new_per_day >= 1) AND (srs_new_per_day <= 9999)))
- `user_settings_srs_review_per_day_check` (check): CHECK (((srs_review_per_day >= 1) AND (srs_review_per_day <= 9999)))

<a id="appuser_stats"></a>
### `app.user_stats`

*table — 1 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `user_id` | bigint | không |  |  |
| 4 | `streak_current` | integer | không | 0 |  |
| 5 | `streak_longest` | integer | không | 0 |  |
| 6 | `last_study_date` | date | có |  |  |
| 7 | `items_learned` | integer | không | 0 |  |
| 8 | `reviews_total` | integer | không | 0 |  |
| 9 | `updated_at` | timestamp with time zone | không | now() |  |

**Khoá chính**: `PRIMARY KEY (user_id)`

**Khoá ngoại**:
- `user_stats_user_id_fkey`: FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE

**Ràng buộc khác**:
- `user_stats_items_learned_check` (check): CHECK ((items_learned >= 0))
- `user_stats_reviews_total_check` (check): CHECK ((reviews_total >= 0))
- `user_stats_streak_current_check` (check): CHECK ((streak_current >= 0))
- `user_stats_streak_longest_check` (check): CHECK ((streak_longest >= 0))

<a id="appusers"></a>
### `app.users`

*table — 1 dòng*

| # | Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|-----|------|------|----------|---------|
| 1 | `id` | bigint | không | identity |  |
| 2 | `email` | text | không |  |  |
| 3 | `display_name` | text | có |  |  |
| 4 | `avatar_url` | text | có |  |  |
| 5 | `status` | text | không | 'active'::text |  |
| 6 | `created_at` | timestamp with time zone | không | now() |  |
| 7 | `last_login_at` | timestamp with time zone | có |  |  |
| 8 | `deleted_at` | timestamp with time zone | có |  |  |
| 9 | `role` | text | không | 'user'::text |  |

**Khoá chính**: `PRIMARY KEY (id)`

**Ràng buộc khác**:
- `users_email_check` (check): CHECK ((btrim(email) <> ''::text))
- `users_role_check` (check): CHECK ((role = ANY (ARRAY['user'::text, 'admin'::text])))
- `users_status_check` (check): CHECK ((status = ANY (ARRAY['active'::text, 'locked'::text, 'deleted'::text])))

**Chỉ mục**:
- `users_admin`: CREATE INDEX users_admin ON app.users USING btree (id) WHERE (role = 'admin'::text)
- `users_by_status`: CREATE INDEX users_by_status ON app.users USING btree (status) WHERE (status <> 'active'::text)
- `users_email_unique`: CREATE UNIQUE INDEX users_email_unique ON app.users USING btree (lower(email))

<a id="servedictionary_search"></a>
### `serve.dictionary_search`

*view*

```sql
 SELECT x.id AS lexeme_id,
    x.language_id,
    l.code AS lang_code,
    x.lemma AS surface,
    x.reading,
    x.pos,
    x.frequency_rank,
    x.homograph_no,
    'lemma'::text AS surface_kind
   FROM core.lexeme x
     JOIN language l ON l.id = x.language_id
UNION ALL
 SELECT x.id AS lexeme_id,
    x.language_id,
    l.code AS lang_code,
    f.form_text AS surface,
    x.reading,
    x.pos,
    x.frequency_rank,
    x.homograph_no,
    f.kind AS surface_kind
   FROM core.lexeme_form f
     JOIN core.lexeme x ON x.id = f.lexeme_id
     JOIN language l ON l.id = x.language_id
```

<a id="servekanji_card"></a>
### `serve.kanji_card`

*view*

```sql
 SELECT k.literal,
    k.codepoint_ucs,
    k.grade,
    k.stroke_count,
    k.frequency_rank,
    k.jlpt_old,
    k.jlpt_new,
    k.radical_classical,
    r."character" AS radical_char,
    r.name_vi AS radical_name_vi,
    r.meaning_vi AS radical_meaning_vi,
    k.readings,
    k.meanings,
    k.nanori,
    k.query_codes,
    ( SELECT count(*) AS count
           FROM core.lexeme_form_kanji_char fc
          WHERE fc.kanji_literal = k.literal) AS used_in_forms,
    ( SELECT array_agg(m.kind ORDER BY m.kind) AS array_agg
           FROM core.kanji_media m
          WHERE m.kanji_literal = k.literal) AS media_kinds
   FROM core.kanji k
     LEFT JOIN radical r ON r.number = k.radical_classical
```

<a id="servesense_card"></a>
### `serve.sense_card`

*view*

```sql
 SELECT se.id AS sense_id,
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
    vi.text AS gloss_vi,
    vi.is_machine AS gloss_vi_machine,
    vi.reviewed_by IS NOT NULL AS gloss_vi_reviewed,
    en.text AS gloss_en,
    sc.concept_id
   FROM core.sense se
     JOIN core.lexeme x ON x.id = se.lexeme_id
     LEFT JOIN LATERAL ( SELECT g.text,
            g.is_machine,
            g.reviewed_by
           FROM core.sense_gloss g
             JOIN language lg ON lg.id = g.language_id
          WHERE g.sense_id = se.id AND lg.code = 'vi'::text
          ORDER BY (g.reviewed_by IS NOT NULL) DESC, g.is_machine, g.rank
         LIMIT 1) vi ON true
     LEFT JOIN LATERAL ( SELECT g.text
           FROM core.sense_gloss g
             JOIN language lg ON lg.id = g.language_id
          WHERE g.sense_id = se.id AND lg.code = 'en'::text
          ORDER BY (g.reviewed_by IS NOT NULL) DESC, g.is_machine, g.rank
         LIMIT 1) en ON true
     LEFT JOIN LATERAL ( SELECT sc_1.concept_id
           FROM core.sense_concept sc_1
             JOIN core.concept c ON c.id = sc_1.concept_id
          WHERE sc_1.sense_id = se.id
          ORDER BY (c.status = 'curated'::text) DESC, sc_1.confidence DESC
         LIMIT 1) sc ON true
```

<a id="servesense_pair"></a>
### `serve.sense_pair`

*materialized view*

```sql
 SELECT sa.id AS sense_a,
    la.language_id AS lang_a,
    sb.id AS sense_b,
    lb.language_id AS lang_b,
    ca.concept_id,
    LEAST(ca.confidence, cb.confidence) AS confidence
   FROM core.sense_concept ca
     JOIN core.sense_concept cb ON cb.concept_id = ca.concept_id AND cb.sense_id <> ca.sense_id
     JOIN core.concept c ON c.id = ca.concept_id AND c.status = 'curated'::text
     JOIN core.sense sa ON sa.id = ca.sense_id
     JOIN core.sense sb ON sb.id = cb.sense_id
     JOIN core.lexeme la ON la.id = sa.lexeme_id
     JOIN core.lexeme lb ON lb.id = sb.lexeme_id
  WHERE la.language_id <> lb.language_id AND LEAST(ca.confidence, cb.confidence) >= 0.7::double precision
```


## M12.1 — Bổ sung quyền riêng tư (03/11/2026)

Nguồn DDL: [migration 047](db/migrations/047_privacy_controls.sql). Mapping:
`PrivacyEvent`, `PrivacyRequest` trong Prisma; [API](docs/api/privacy.md).

- `app.privacy_event`: `id` bigint identity; `user_id` FK users/cascade;
  `request_id` UUID, unique theo user; `purpose_id`, `action`, `notice_version`;
  `created_at` timestamptz. Check purpose/action/version; index user/purpose/id DESC.
  Biên nhận sự kiện theo phiên bản, không ghi nội dung chat, IP hoặc giấy tờ.
- `app.privacy_request`: `id` UUID; `user_id` FK users/cascade; `request_id` UUID
  unique theo user; `kind`, `status`, received/acknowledged/target/updated timestamps;
  `updated_by` FK users/set null; `rejection_reason`, `resolution_reference`.
  Check kind/status/lý do; index hàng đợi status/received_at/id.
- `completed` và `resolution_reference` được dành sẵn ở schema; API đợt này chỉ nhận
  ticket và chuyển `in_progress`/`rejected`, không tự export hoặc xóa dữ liệu.
- Không thêm ngày sinh, giới hạn tuổi hoặc thông tin xác minh người đại diện.
  Retention và việc xóa ledger cần quy trình được duyệt riêng; cascade theo user
  không thay thế quy trình xử lý file, vendor và backup.

### M12.1 — Terms acceptance (04/11/2026)

Nguồn: [migration048](db/migrations/048_terms_acceptance.sql), Prisma `TermsAcceptance`.
`app.terms_acceptance`: id bigint identity PK, user_id FK app.users/cascade,
request_id UUID, terms_version text length1–80, accepted_at timestamptz6 default now.
Unique `(user_id,request_id)`, index `(user_id,id DESC)`. Không sửa privacy_event/check
purpose của 047; receipt terms và grant/withdraw dữ liệu là hai loại record riêng.
Không thu IP/UA/ngày sinh/CCCD. Migration đã áp DB test riêng và sau yêu cầu push đã áp chỉ048 trên production;
ledger048 một dòng, giữ043 pending và không reset DB live. [API](docs/api/privacy.md).

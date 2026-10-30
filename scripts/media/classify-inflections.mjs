#!/usr/bin/env node
/**
 * M14.2 — Phân loại từ và concept thể chia tiếng Anh thành 4 nhóm cho pipeline sinh ảnh AI.
 *
 * Nhóm 1: VISUAL_PARTICIPLE_ADJECTIVE (Tính từ phân từ trực quan — Nên gen ảnh riêng)
 * Nhóm 2: GERUND_ACTIVITY_ARTIFACT_NOUN (Danh từ hoạt động / nghề / hiện vật — Nên gen ảnh riêng)
 * Nhóm 3: INHERIT_ROOT (Động từ chia thì & danh từ số nhiều — Nối dùng chung ảnh từ gốc)
 * Nhóm 4: ABSTRACT_NO_IMAGE (Trợ động từ, ngữ pháp & từ trừu tượng — Bỏ qua ảnh)
 */

import { Client } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

const envPath = process.env.M141_APP_ROOT
  ? path.join(process.env.M141_APP_ROOT, '.env')
  : path.resolve(process.cwd(), '.env');

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  await client.connect();
  console.log('--- M14.2: PHÂN LOẠI THỂ CHIA TIẾNG ANH CHO ẢNH AI ---');

  // 1. Phân loại tầng Concept (core.concept) có chứa các từ -ed, -ing, -en
  const conceptQuery = `
    WITH concept_words AS (
      SELECT DISTINCT
        c.id AS concept_id,
        c.pos,
        c.gloss_en,
        c.gloss_vi,
        c.status,
        l.id AS lexeme_id,
        l.lemma
      FROM core.concept c
      JOIN core.sense_concept sc ON sc.concept_id = c.id
      JOIN core.sense s ON s.id = sc.sense_id
      JOIN core.lexeme l ON l.id = s.lexeme_id
      WHERE l.language_id = 1
        AND l.lemma ~* '(ed|ing|en)$'
    )
    SELECT
      concept_id,
      pos,
      gloss_en,
      gloss_vi,
      status,
      lexeme_id,
      lemma,
      CASE
        -- Nhóm 4: Trợ động từ, từ trừu tượng, logic, trạng từ
        WHEN pos = 'adverb'
          OR lemma IN ('being', 'having', 'willing', 'meaning', 'feeling', 'seeming', 
                       'understanding', 'reasoning', 'believing', 'belonging', 
                       'seemed', 'occurred', 'resulted', 'implied', 'depended')
          OR gloss_en ~* '(pertaining to|relating to|in a manner|quality of being|state of being|philosophical|logical|the act of thinking|degree|grammatical)'
          THEN 'GROUP_4_ABSTRACT_NO_IMAGE'

        -- Nhóm 1: Tính từ phân từ trực quan
        WHEN pos = 'adjective'
          THEN 'GROUP_1_VISUAL_PARTICIPLE_ADJECTIVE'

        -- Nhóm 2: Danh từ hoạt động, môn thể thao, nghề nghiệp, hiện vật
        WHEN pos = 'noun'
          THEN 'GROUP_2_GERUND_ACTIVITY_ARTIFACT_NOUN'

        -- Nhóm 3: Động từ chia thì / phân từ làm vị ngữ
        WHEN pos = 'verb'
          THEN 'GROUP_3_INHERIT_ROOT_VERB'

        ELSE 'GROUP_4_ABSTRACT_NO_IMAGE'
      END AS classification
    FROM concept_words;
  `;

  const conceptRes = await client.query(conceptQuery);
  console.log(`Đã phân tích ${conceptRes.rows.length} mục concept phái sinh.`);

  const summary = {
    group1_visual_adjectives: [],
    group2_gerund_nouns: [],
    group3_inherit_verbs: [],
    group4_abstract_no_image: [],
  };

  const seenConcepts = new Set();
  for (const row of conceptRes.rows) {
    if (!seenConcepts.has(row.concept_id)) {
      seenConcepts.add(row.concept_id);
      if (row.classification === 'GROUP_1_VISUAL_PARTICIPLE_ADJECTIVE') {
        summary.group1_visual_adjectives.push(row);
      } else if (
        row.classification === 'GROUP_2_GERUND_ACTIVITY_ARTIFACT_NOUN'
      ) {
        summary.group2_gerund_nouns.push(row);
      } else if (row.classification === 'GROUP_3_INHERIT_ROOT_VERB') {
        summary.group3_inherit_verbs.push(row);
      } else {
        summary.group4_abstract_no_image.push(row);
      }
    }
  }

  console.log('--- KẾT QUẢ PHÂN LOẠI TẦNG CONCEPT ---');
  console.log(
    `Nhóm 1 (Tính từ phân từ trực quan - Gen riêng): ${summary.group1_visual_adjectives.length} concepts`,
  );
  console.log(
    `Nhóm 2 (Danh từ hoạt động/nghề/hiện vật - Gen riêng): ${summary.group2_gerund_nouns.length} concepts`,
  );
  console.log(
    `Nhóm 3 (Động từ chia thì - Nối ảnh từ gốc): ${summary.group3_inherit_verbs.length} concepts`,
  );
  console.log(
    `Nhóm 4 (Trừu tượng/Trợ từ - Bỏ qua ảnh): ${summary.group4_abstract_no_image.length} concepts`,
  );

  // 2. Thống kê tầng Sense thuần ngữ pháp (Wiktionary grammatical senses)
  const senseGrammarQuery = `
    SELECT 
      CASE 
        WHEN l.lemma IN ('did', 'done', 'doing', 'was', 'were', 'been', 'being', 'had', 'having', 'became', 'seemed', 'existed') 
          THEN 'GROUP_4_ABSTRACT_NO_IMAGE'
        ELSE 'GROUP_3_INHERIT_ROOT_INFLECTION'
      END AS classification,
      count(*) AS sense_count,
      count(DISTINCT l.lemma) AS lemma_count
    FROM core.sense s
    JOIN core.lexeme l ON l.id = s.lexeme_id
    WHERE l.language_id = 1
      AND s.definition ~* '^(simple past( and past participle)? of|past participle of|present participle (and gerund )?of|gerund of|plural of|third-person singular (simple present )?of|comparative of|superlative of)'
    GROUP BY 1;
  `;
  const senseRes = await client.query(senseGrammarQuery);
  console.log('\n--- KẾT QUẢ PHÂN LOẠI TẦNG SENSE THUẦN NGỮ PHÁP ---');
  for (const row of senseRes.rows) {
    console.log(
      `${row.classification}: ${row.sense_count} senses (${row.lemma_count} từ vựng)`,
    );
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../db/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import {
  QuizSourceItem,
  KanjiPair,
  QuizExample,
} from '../../providers/ai-quiz.provider';
import { fingerprint } from '../quiz-contract';

interface SourceRow {
  item_id: string;
  sense_id: bigint;
  concept_id: bigint | null;
  language_id: number;
  lemma: string;
  reading: string | null;
  romanization: string | null;
  meaning_vi: string;
}

/**
 * Nguồn từ vựng cho quiz: item thuộc profile (collection không archive, item
 * không paused) + nghĩa/language đọc từ serve.sense_card.
 * Thứ tự ưu tiên: review → relearning → learning → new, rồi vị trí item.
 */
@Injectable()
export class QuizSourceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findSourceItems(
    params: {
      userId: bigint;
      profileId: string;
      collectionId: string | null;
      enrichKanji?: boolean;
      withExamples?: boolean;
    },
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<QuizSourceItem[]> {
    const { userId, profileId, collectionId } = params;
    const rows = await client.$queryRaw<SourceRow[]>(Prisma.sql`
      SELECT
        i.id AS item_id,
        visible_face.sense_id AS sense_id,
        i.concept_id,
        sc.language_id,
        sc.lemma,
        sc.reading,
        sc.romanization,
        COALESCE(NULLIF(btrim(i.meaning_vi), ''), sc.gloss_vi, sc.gloss_en, sc.lemma) AS meaning_vi
      FROM app.collection_item i
      JOIN app.collection c ON c.id = i.collection_id
      JOIN app.study_profile p ON p.id=c.profile_id AND p.user_id=c.owner_id
      JOIN LATERAL (
        SELECT f.id, f.sense_id
        FROM app.collection_item_face f
        WHERE f.item_id=i.id AND f.language_id IN (p.primary_language_id, p.secondary_language_id)
        ORDER BY CASE WHEN f.sense_id=i.anchor_sense_id THEN 0 ELSE 1 END, f.id
        LIMIT 1
      ) visible_face ON true
      -- Keep lookup parameterized by the selected face. Flattening this join
      -- can make PostgreSQL project the whole sense_card view before matching.
      JOIN LATERAL (
        SELECT card.language_id, card.lemma, card.reading, card.romanization,
               card.gloss_vi, card.gloss_en
        FROM serve.sense_card card
        WHERE card.sense_id = visible_face.sense_id
        OFFSET 0
      ) sc ON true
      JOIN LATERAL (
        SELECT s.state
        FROM app.srs_state s
        WHERE s.user_id = ${userId}
          AND s.profile_id = ${profileId}::uuid
          AND s.face_id = visible_face.id
        ORDER BY CASE s.state
                   WHEN 'review' THEN 1
                   WHEN 'relearning' THEN 2
                   WHEN 'learning' THEN 3
                   ELSE 4
                 END
        LIMIT 1
      ) st ON true
      WHERE c.owner_id = ${userId}
        AND c.profile_id = ${profileId}::uuid
        AND c.archived_at IS NULL
        AND i.status <> 'paused'
        AND (${collectionId}::uuid IS NULL OR i.collection_id = ${collectionId}::uuid)
      ORDER BY
        CASE st.state
          WHEN 'review' THEN 1
          WHEN 'relearning' THEN 2
          WHEN 'learning' THEN 3
          ELSE 4
        END,
        i.position,
        i.id
    `);

    const items: QuizSourceItem[] = rows.map((row) => ({
      itemId: row.item_id,
      senseId: row.sense_id.toString(),
      conceptId: row.concept_id?.toString() ?? null,
      languageId: Number(row.language_id),
      lemma: row.lemma,
      reading: row.reading,
      romanization: row.romanization,
      meaningVi: row.meaning_vi,
    }));
    if (params.enrichKanji && items.length > 0)
      await this.enrich(items, client, params.withExamples ?? false);
    return items;
  }

  private async enrich(
    items: QuizSourceItem[],
    client: Prisma.TransactionClient,
    withExamples: boolean,
  ): Promise<void> {
    const ids = [...new Set(items.map((item) => BigInt(item.senseId)))];
    const details = await client.$queryRaw<
      {
        sense_id: bigint;
        code: string;
        pos: string | null;
        gloss_en: string[];
        machine: boolean | null;
      }[]
    >(Prisma.sql`
      SELECT s.id AS sense_id, lg.code, x.pos,
        ARRAY(SELECT g.text FROM core.sense_gloss g JOIN public.language gl ON gl.id=g.language_id
          WHERE g.sense_id=s.id AND gl.code='en' ORDER BY g.rank,g.id) AS gloss_en,
        sc.gloss_vi_machine AS machine
      FROM core.sense s JOIN core.lexeme x ON x.id=s.lexeme_id
      JOIN public.language lg ON lg.id=x.language_id JOIN serve.sense_card sc ON sc.sense_id=s.id
      WHERE s.id IN (${Prisma.join(ids)})
    `);
    const pairs = await client.$queryRaw<
      {
        sense_id: bigint;
        written: string;
        reading: string;
        eligible: boolean;
      }[]
    >(Prisma.sql`
      SELECT s.id AS sense_id, k.form_text AS written, r.form_text AS reading,
        (EXISTS(SELECT 1 FROM core.sense_form sf WHERE sf.sense_id=s.id AND sf.form_id=k.id)
         AND EXISTS(SELECT 1 FROM core.sense_form sf WHERE sf.sense_id=s.id AND sf.form_id=r.id)
         AND NOT EXISTS(SELECT 1 FROM core.lexeme_form_tag t WHERE t.form_id IN (k.id,r.id)
           AND t.tag_code IN ('sK','sk','iK','ik','io','oK','ok','rK','rk','ateji'))) AS eligible
      FROM core.sense s JOIN core.lexeme x ON x.id=s.lexeme_id
      JOIN public.language lg ON lg.id=x.language_id AND lg.code='ja'
      JOIN core.lexeme_form k ON k.lexeme_id=x.id AND k.kind='kanji'
      JOIN core.lexeme_form r ON r.lexeme_id=x.id AND r.kind='kana'
      JOIN core.lexeme_form_applies_to a ON a.form_id=r.id AND a.target_form_id=k.id
      WHERE s.id IN (${Prisma.join(ids)}) ORDER BY s.id,k.form_order,r.form_order
    `);
    // Include other dictionary entries with the same spelling as exclusions,
    // while target eligibility remains restricted to the user's anchor sense.
    const written = [...new Set(pairs.map((p) => p.written))];
    const aliases =
      written.length === 0
        ? []
        : await client.$queryRaw<
            { written: string; reading: string }[]
          >(Prisma.sql`
      SELECT DISTINCT k.form_text AS written,r.form_text AS reading
      FROM core.lexeme_form k JOIN core.lexeme_form_applies_to a ON a.target_form_id=k.id
      JOIN core.lexeme_form r ON r.id=a.form_id AND r.kind='kana'
      WHERE k.kind='kanji' AND k.form_text IN (${Prisma.join(written)})
      ORDER BY k.form_text,r.form_text
    `);
    const bySense = new Map<string, KanjiPair[]>();
    for (const pair of pairs) {
      const key = pair.sense_id.toString();
      const values = bySense.get(key) ?? [];
      values.push({
        written: pair.written,
        reading: pair.reading,
        eligible: pair.eligible,
      });
      bySense.set(key, values);
    }
    const detailBySense = new Map(
      details.map((d) => [d.sense_id.toString(), d]),
    );
    const aliasesByWritten = new Map<
      string,
      { written: string; reading: string }[]
    >();
    for (const alias of aliases) {
      const group = aliasesByWritten.get(alias.written) ?? [];
      group.push(alias);
      aliasesByWritten.set(alias.written, group);
    }
    for (const item of items) {
      const detail = detailBySense.get(item.senseId);
      item.languageCode = detail?.code;
      item.pos = detail?.pos ?? null;
      item.glossEn = detail?.gloss_en ?? [];
      item.glossViMachine = detail?.machine ?? false;
      item.kanjiPairs = bySense.get(item.senseId) ?? [];
      const ownSpellings = new Set(item.kanjiPairs.map((p) => p.written));
      for (const alias of [...ownSpellings].flatMap(
        (w) => aliasesByWritten.get(w) ?? [],
      )) {
        if (
          ownSpellings.has(alias.written) &&
          !item.kanjiPairs.some(
            (p) => p.written === alias.written && p.reading === alias.reading,
          )
        ) {
          item.kanjiPairs.push({ ...alias, eligible: false });
        }
      }
    }
    if (withExamples) await this.examples(items, ids, client);
  }

  private async examples(
    items: QuizSourceItem[],
    ids: bigint[],
    client: Prisma.TransactionClient,
  ): Promise<void> {
    const rows = await client.$queryRaw<
      {
        sense_id: bigint;
        id: bigint;
        text: string;
        attribution: string;
        version: string;
        sha256: string;
        license: string;
      }[]
    >(Prisma.sql`
      WITH linked AS (
        SELECT e.sense_id,e.id FROM core.example e WHERE e.sense_id IN (${Prisma.join(ids)})
        UNION SELECT es.sense_id,es.example_id FROM core.example_sense es
          WHERE es.sense_id IN (${Prisma.join(ids)}) AND es.verified AND es.relation='illustrates'
      ), ranked AS (
        SELECT l.sense_id,e.id,e.text,src.attribution,src.version,src.sha256,src.license,
          row_number() OVER (PARTITION BY l.sense_id ORDER BY e.id) AS rn
        FROM linked l JOIN core.example e ON e.id=l.id
        JOIN public.language lg ON lg.id=e.language_id AND lg.code='ja'
        JOIN public.source src ON src.id=e.source_id
        WHERE char_length(e.text) BETWEEN 1 AND 240 AND nullif(btrim(src.version),'') IS NOT NULL
          AND src.sha256 ~ '^[a-fA-F0-9]{64}$' AND btrim(src.attribution)<>''
          AND src.license ~* '^(CC[ -]BY([ -]SA)?([ -](3[.]0|4[.]0))?|CC0([ -]1[.]0)?|Public Domain)$'
      ) SELECT sense_id,id,text,attribution,version,sha256,license FROM ranked WHERE rn<=8
    `);
    const bySense = new Map<string, QuizExample[]>();
    for (const row of rows) {
      const key = row.sense_id.toString();
      const examples = bySense.get(key) ?? [];
      examples.push({
        id: row.id.toString(),
        sentence: row.text,
        attribution: row.attribution,
        sourceHash: fingerprint([
          row.text,
          row.version,
          row.sha256,
          row.license,
          row.attribution,
        ]),
      });
      bySense.set(key, examples);
    }
    for (const item of items) item.examples = bySense.get(item.senseId) ?? [];
  }
}

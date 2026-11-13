import { ItemDisplayDto } from '../dto/item-display.dto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import { Prisma } from '../../generated/prisma/client';

export interface SenseLanguageRow {
  sense_id: bigint;
  language_id: number;
  lemma: string;
  concept_id: bigint | null;
}

export interface SensePairRow {
  concept_id: bigint;
  confidence: number;
}

/**
 * Tra sense trong `core` để lấy ngôn ngữ (bất biến §5.9: service tự kiểm
 * face.language_id khớp ngôn ngữ của sense — client không gửi language_id).
 */
@Injectable()
export class SenseLookupRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findManyByIds(ids: bigint[]): Promise<SenseLanguageRow[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.prisma.$queryRaw<SenseLanguageRow[]>`
      SELECT
        s.id AS sense_id,
        x.language_id,
        x.lemma,
        (
          SELECT sc.concept_id
          FROM core.sense_concept sc
          JOIN core.concept c ON c.id = sc.concept_id
          WHERE sc.sense_id = s.id
            AND c.status = 'curated'
            AND sc.confidence >= 0.7
          ORDER BY sc.confidence DESC, sc.concept_id ASC
          LIMIT 1
        ) AS concept_id
      FROM core.sense s
      JOIN core.lexeme x ON x.id = s.lexeme_id
      WHERE s.id IN (${Prisma.join(ids)})
    `;
  }

  /** Two bounded core reads for a whole page; no examples, concept links or media. */
  async findDisplays(
    ids: bigint[],
    allowedLanguageIds: number[],
  ): Promise<Map<string, ItemDisplayDto>> {
    if (ids.length === 0 || allowedLanguageIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<
      {
        sense_id: bigint;
        lemma: string;
        reading: string | null;
        romanization: string | null;
        pos: string | null;
        gloss_en: string | null;
        gloss_vi: string | null;
        gloss_vi_machine: boolean | null;
        gloss_vi_reviewed: boolean | null;
      }[]
    >`
      SELECT sc.sense_id, sc.lemma, sc.reading, sc.romanization, sc.pos,
             sc.gloss_en, sc.gloss_vi, sc.gloss_vi_machine, sc.gloss_vi_reviewed
      FROM serve.sense_card sc
      WHERE sc.sense_id IN (${Prisma.join(ids)}) AND sc.language_id IN (${Prisma.join(allowedLanguageIds)})
    `;
    const chars = [
      ...new Set(
        rows.flatMap((row) =>
          Array.from(row.lemma).filter((char) => /\p{Script=Han}/u.test(char)),
        ),
      ),
    ];
    const kanji =
      chars.length === 0
        ? []
        : await this.prisma.$queryRaw<
            {
              literal: string;
              readings: unknown;
              meanings: unknown;
            }[]
          >`SELECT literal, readings, meanings FROM core.kanji WHERE literal IN (${Prisma.join(chars)})`;
    const byChar = new Map(
      kanji.map((row) => [
        row.literal,
        {
          literal: row.literal,
          readings_vi: kanjiValues(row.readings, 'type', 'vietnam'),
          meanings_vi: kanjiValues(row.meanings, 'lang', 'vi'),
          ...kanjiTranslationFlags(row.meanings),
        },
      ]),
    );
    return new Map(
      rows.map((row) => [
        row.sense_id.toString(),
        {
          sense_id: row.sense_id.toString(),
          lemma: row.lemma,
          reading: row.reading,
          romanization: row.romanization,
          pos: row.pos,
          gloss_en: row.gloss_en ?? null,
          gloss_vi: row.gloss_vi ?? null,
          gloss_vi_machine: row.gloss_vi_machine === true,
          gloss_vi_reviewed: row.gloss_vi_reviewed === true,
          kanji: [
            ...new Set(
              Array.from(row.lemma).filter((char) =>
                /\p{Script=Han}/u.test(char),
              ),
            ),
          ].map(
            (literal) =>
              byChar.get(literal) ?? {
                literal,
                readings_vi: [],
                meanings_vi: [],
                meanings_vi_machine: false,
                meanings_vi_reviewed: false,
              },
          ),
        },
      ]),
    );
  }

  async hasCuratedConceptMapping(
    senseId: bigint,
    conceptId: bigint,
  ): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ ok: number }[]>`
      SELECT 1 AS ok
      FROM core.sense_concept sc
      JOIN core.concept c ON c.id = sc.concept_id
      WHERE sc.sense_id = ${senseId}
        AND sc.concept_id = ${conceptId}
        AND c.status = 'curated'
        AND sc.confidence >= 0.7
      LIMIT 1
    `;
    return rows.length > 0;
  }

  /**
   * The materialized view is the serving gate. Re-checking the base mappings
   * prevents a stale view from accepting a pair that was later downgraded.
   */
  async findCuratedPair(
    firstSenseId: bigint,
    secondSenseId: bigint,
  ): Promise<SensePairRow | null> {
    const served = await this.prisma.$queryRaw<SensePairRow[]>`
      SELECT concept_id, confidence
      FROM serve.sense_pair
      WHERE (sense_a = ${firstSenseId} AND sense_b = ${secondSenseId})
         OR (sense_a = ${secondSenseId} AND sense_b = ${firstSenseId})
      ORDER BY confidence DESC, concept_id ASC
      LIMIT 1
    `;
    const pair = served[0];
    if (!pair) {
      return null;
    }

    const verified = await this.prisma.$queryRaw<SensePairRow[]>`
      SELECT
        ca.concept_id,
        LEAST(ca.confidence, cb.confidence) AS confidence
      FROM core.sense_concept ca
      JOIN core.sense_concept cb
        ON cb.concept_id = ca.concept_id
       AND cb.sense_id = ${secondSenseId}
      JOIN core.concept c ON c.id = ca.concept_id
      WHERE ca.sense_id = ${firstSenseId}
        AND ca.concept_id = ${pair.concept_id}
        AND c.status = 'curated'
        AND ca.confidence >= 0.7
        AND cb.confidence >= 0.7
      LIMIT 1
    `;
    return verified[0] ?? null;
  }
}

function kanjiValues(raw: unknown, key: string, expected: string): string[] {
  if (
    !raw ||
    typeof raw !== 'object' ||
    !('groups' in raw) ||
    !Array.isArray(raw.groups)
  )
    return [];
  return [
    ...new Set(
      raw.groups.flat().flatMap((entry: unknown) => {
        if (!entry || typeof entry !== 'object') return [];
        const item = entry as Record<string, unknown>;
        return item[key] === expected &&
          typeof item.value === 'string' &&
          item.value.trim()
          ? [item.value]
          : [];
      }),
    ),
  ];
}

/** Preserve the machine/unreviewed quality gate when flattening dictionary JSON. */
function kanjiTranslationFlags(raw: unknown): {
  meanings_vi_machine: boolean;
  meanings_vi_reviewed: boolean;
} {
  if (
    !raw ||
    typeof raw !== 'object' ||
    !('groups' in raw) ||
    !Array.isArray(raw.groups)
  )
    return { meanings_vi_machine: false, meanings_vi_reviewed: false };
  const machine = raw.groups
    .flat()
    .filter(
      (entry: unknown): entry is Record<string, unknown> =>
        Boolean(entry) &&
        typeof entry === 'object' &&
        (entry as Record<string, unknown>).lang === 'vi' &&
        (entry as Record<string, unknown>).is_machine === true,
    );
  return {
    meanings_vi_machine: machine.length > 0,
    meanings_vi_reviewed:
      machine.length > 0 &&
      machine.every((entry) => entry.review_status === 'reviewed'),
  };
}

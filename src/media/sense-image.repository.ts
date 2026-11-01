import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../db/prisma.service';
import {
  ImageCandidate,
  SenseImageSource,
  RootResolutionRow,
} from './types/image.types';

interface DirectCandidateSqlRow {
  sense_id: bigint;
  lemma: string;
  pos: string | null;
  language_id: number;
  definition: string;
  asset_id: bigint | null;
  concept_id: bigint | null;
  anchor_sense_id: bigint | null;
  object_key: string | null;
  mime: string | null;
  bytes: number | null;
  sha256: string | null;
  provider: string | null;
  metadata: unknown;
}

export interface RootCandidatesResult {
  relations: RootResolutionRow[];
  lexicalRoots: {
    sense_id: bigint;
    lemma: string;
    pos: string | null;
    language_id: number;
    definition: string;
  }[];
}

@Injectable()
export class SenseImageRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findSourcesWithDirectImages(
    tx: Prisma.TransactionClient | PrismaService,
    ids: bigint[],
  ): Promise<SenseImageSource[]> {
    if (ids.length === 0) {
      return [];
    }

    const uniqueIds = Array.from(new Set(ids));

    const rows = await tx.$queryRaw<DirectCandidateSqlRow[]>(Prisma.sql`
      WITH requested_senses AS (
        SELECT s.id AS sense_id, l.lemma, l.pos, l.language_id, s.definition
        FROM core.sense s
        JOIN core.lexeme l ON l.id = s.lexeme_id
        WHERE s.id IN (${Prisma.join(uniqueIds)})
      ),
      candidates AS (
        -- Tier 1: Anchor sense match
        SELECT
          rs.sense_id,
          1 AS tier,
          1.0::real AS confidence,
          sci.asset_id,
          sci.concept_id,
          sci.anchor_sense_id,
          sci.object_key,
          sci.mime,
          sci.bytes,
          sci.sha256,
          sci.provider,
          ma.metadata
        FROM requested_senses rs
        JOIN serve.concept_image sci ON sci.anchor_sense_id = rs.sense_id
        JOIN core.media_asset ma ON ma.id = sci.asset_id

        UNION ALL

        -- Tier 2: Source provenance match (matching source_sense_id and source_definition)
        SELECT
          rs.sense_id,
          2 AS tier,
          1.0::real AS confidence,
          sci.asset_id,
          sci.concept_id,
          sci.anchor_sense_id,
          sci.object_key,
          sci.mime,
          sci.bytes,
          sci.sha256,
          sci.provider,
          ma.metadata
        FROM requested_senses rs
        JOIN core.media_asset ma ON (
          ma.metadata->>'source_sense_id' = rs.sense_id::text
          AND ma.metadata->>'source_definition' = rs.definition
        )
        JOIN serve.concept_image sci ON sci.asset_id = ma.id

        UNION ALL

        -- Tier 3: Valid concept mapping
        SELECT
          rs.sense_id,
          3 AS tier,
          sc.confidence,
          sci.asset_id,
          sci.concept_id,
          sci.anchor_sense_id,
          sci.object_key,
          sci.mime,
          sci.bytes,
          sci.sha256,
          sci.provider,
          ma.metadata
        FROM requested_senses rs
        JOIN core.sense_concept sc ON sc.sense_id = rs.sense_id
          AND sc.relation = 'exact'
          AND sc.verified = true
          AND sc.confidence >= 0.7
        JOIN serve.concept_image sci ON sci.concept_id = sc.concept_id
        JOIN core.media_asset ma ON ma.id = sci.asset_id
      ),
      ranked_candidates AS (
        SELECT *,
          ROW_NUMBER() OVER (
            PARTITION BY sense_id
            ORDER BY
              tier ASC,
              confidence DESC,
              asset_id ASC,
              concept_id ASC
          ) AS rank
        FROM candidates
      )
      SELECT
        rs.sense_id,
        rs.lemma,
        rs.pos,
        rs.language_id,
        rs.definition,
        rc.asset_id,
        rc.concept_id,
        rc.anchor_sense_id,
        rc.object_key,
        rc.mime,
        rc.bytes,
        rc.sha256,
        rc.provider,
        rc.metadata
      FROM requested_senses rs
      LEFT JOIN ranked_candidates rc ON rc.sense_id = rs.sense_id AND rc.rank = 1
    `);

    return rows.map((r) => ({
      sense_id: r.sense_id,
      lemma: r.lemma,
      pos: r.pos,
      language_id: r.language_id,
      definition: r.definition,
      directCandidate:
        r.asset_id !== null && r.object_key !== null && r.mime !== null
          ? {
              asset_id: r.asset_id,
              concept_id: r.concept_id ?? undefined,
              anchor_sense_id: r.anchor_sense_id ?? undefined,
              object_key: r.object_key,
              mime: r.mime,
              bytes: r.bytes,
              sha256: r.sha256,
              provider: r.provider,
              metadata: r.metadata,
            }
          : null,
    }));
  }

  async findDirectImages(
    tx: Prisma.TransactionClient | PrismaService,
    ids: bigint[],
  ): Promise<Map<string, ImageCandidate | null>> {
    const sources = await this.findSourcesWithDirectImages(tx, ids);
    const map = new Map<string, ImageCandidate | null>();
    for (const s of sources) {
      map.set(s.sense_id.toString(), s.directCandidate);
    }
    return map;
  }

  async findRootCandidates(
    tx: Prisma.TransactionClient | PrismaService,
    inflectionSources: {
      sense_id: bigint;
      rootLemma: string;
      rootPos: string;
      language_id: number;
    }[],
  ): Promise<RootCandidatesResult> {
    if (inflectionSources.length === 0) {
      return { relations: [], lexicalRoots: [] };
    }

    const sourceIds = inflectionSources.map((s) => s.sense_id);
    const rootLemmas = Array.from(
      new Set(inflectionSources.map((s) => s.rootLemma)),
    );
    const languageIds = Array.from(
      new Set(inflectionSources.map((s) => s.language_id)),
    );

    const rows = await tx.$queryRaw<
      {
        kind: string;
        source_sense_id: bigint | null;
        target_sense_id: bigint;
        method: string | null;
        confidence: number | null;
        lemma: string;
        pos: string | null;
        language_id: number;
        definition: string;
      }[]
    >(Prisma.sql`
      SELECT 'relation' AS kind, sr.source_sense_id, sr.target_sense_id,
        sr.method, sr.confidence, l.lemma, l.pos, l.language_id, s.definition
      FROM core.sense_relation sr
      JOIN core.sense s ON s.id=sr.target_sense_id
      JOIN core.lexeme l ON l.id=s.lexeme_id
      WHERE sr.source_sense_id IN (${Prisma.join(sourceIds)})
        AND sr.relation='equivalent' AND sr.verified
        AND sr.method='inflection_root_verified_v1'
      UNION ALL
      SELECT 'lexical', NULL::bigint, s.id, NULL::text, NULL::real,
        l.lemma, l.pos, l.language_id, s.definition
      FROM core.sense s JOIN core.lexeme l ON l.id=s.lexeme_id
      WHERE l.lemma IN (${Prisma.join(rootLemmas)})
        AND l.language_id IN (${Prisma.join(languageIds)})
    `);
    return {
      relations: rows
        .filter((r) => r.kind === 'relation')
        .map((r) => ({
          source_sense_id: r.source_sense_id!,
          target_sense_id: r.target_sense_id,
          method: r.method!,
          confidence: r.confidence!,
          target_language_id: r.language_id,
          target_pos: r.pos,
          target_lemma: r.lemma,
          target_definition: r.definition,
        })),
      lexicalRoots: rows
        .filter((r) => r.kind === 'lexical')
        .map((r) => ({
          sense_id: r.target_sense_id,
          lemma: r.lemma,
          pos: r.pos,
          language_id: r.language_id,
          definition: r.definition,
        })),
    };
  }
}

import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { DomainException } from '../common/errors/domain.exception';
import { parsePositivePostgresBigInt } from '../common/ids/postgres-id';
import { PrismaService } from '../db/prisma.service';
import { AdminAuditService } from './admin-audit.service';
import {
  AdminCurationConceptQueryDto,
  AdminCurationSearchQueryDto,
  CreateCurationGlossDto,
  CreateCurationMappingDto,
  UpdateCurationConceptDto,
  UpdateCurationGlossDto,
} from './dto/admin-curation.dto';

const ADMIN_SOURCE_CODE = 'admin-curation';
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 50;

interface SenseSearchRow {
  id: bigint;
  externalId: string;
  senseNo: number;
  lemma: string;
  reading: string | null;
  romanization: string | null;
  pos: string | null;
  links: number;
  glossVi: string | null;
}

interface SenseDetailRow {
  id: bigint;
  externalId: string;
  senseNo: number;
  definition: string | null;
  register: string | null;
  domain: string | null;
  isPrimary: boolean;
  lexemeId: bigint;
  lemma: string;
  reading: string | null;
  romanization: string | null;
  pos: string | null;
  frequencyRank: number | null;
}

interface GlossRow {
  id: bigint;
  senseId: bigint;
  text: string;
  isMachine: boolean;
  quality: number | null;
  rank: number;
  reviewedBy: bigint | null;
  reviewedByEmail: string | null;
  reviewedAt: Date | null;
}

interface MappingRow {
  conceptId: bigint;
  relation: string | null;
  confidence: number | null;
  method: string | null;
  verified: boolean | null;
  sourceCode: string | null;
  mappingRun: string | null;
  reviewedBy: bigint | null;
  reviewedAt: Date | null;
  decidedAt: Date | null;
  conceptGlossEn: string | null;
  conceptGlossVi: string | null;
  conceptStatus: string;
  conceptPos: string | null;
}

interface ReportRow {
  id: bigint;
  targetKind: string;
  targetId: string;
  issue: string;
  comment: string | null;
  status: string;
  createdAt: Date;
  resolvedAt: Date | null;
}

/**
 * M14 — curation ghi `core`: admin sửa gloss VI và sửa/xoá/thêm nối nghĩa sense↔concept.
 * Mọi mutation đi kèm audit (`app.admin_audit_log`) trong cùng transaction; thay đổi
 * ảnh hưởng `serve.sense_pair` sẽ kích hoạt refresh nền (concurrently).
 */
@Injectable()
export class AdminCurationService {
  private readonly logger = new Logger(AdminCurationService.name);
  private refreshRunning = false;
  private refreshQueued = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  // ============================== READ ==============================

  async searchSenses(
    query: AdminCurationSearchQueryDto,
  ): Promise<{ data: Record<string, unknown>[] }> {
    const limit = Math.min(
      Math.max(query.limit ?? DEFAULT_SEARCH_LIMIT, 1),
      MAX_SEARCH_LIMIT,
    );
    const lang = query.lang ?? 'ja';
    const q = query.q.trim();
    const escaped = q
      .replaceAll('\\', '\\\\')
      .replaceAll('%', '\\%')
      .replaceAll('_', '\\_');
    const like = `%${escaped}%`;

    const rows = await this.prisma.$queryRaw<SenseSearchRow[]>(Prisma.sql`
      SELECT s.id,
             s.external_id AS "externalId",
             s.sense_no AS "senseNo",
             l.lemma,
             l.reading,
             l.romanization,
             l.pos,
             (SELECT count(*)::int FROM core.sense_concept sc WHERE sc.sense_id = s.id) AS links,
             (SELECT g.text FROM core.sense_gloss g
                JOIN public.language lg ON lg.id = g.language_id
               WHERE g.sense_id = s.id AND lg.code = 'vi'
               ORDER BY (g.reviewed_by IS NOT NULL) DESC, g.is_machine, g.rank, g.id
               LIMIT 1) AS "glossVi"
        FROM core.sense s
        JOIN core.lexeme l ON l.id = s.lexeme_id
       WHERE l.language_id = (SELECT id FROM public.language WHERE code = ${lang})
         AND (s.external_id = ${q}
              OR l.lemma ILIKE ${like}
              OR coalesce(l.reading, '') ILIKE ${like}
              OR coalesce(l.romanization, '') ILIKE ${like})
       ORDER BY (s.external_id = ${q}) DESC, char_length(l.lemma), l.lemma, s.sense_no
       LIMIT ${limit}
    `);

    return {
      data: rows.map((row) => ({
        sense_id: row.id.toString(),
        external_id: row.externalId,
        sense_no: row.senseNo,
        lemma: row.lemma,
        reading: row.reading,
        romanization: row.romanization,
        pos: row.pos,
        links: row.links,
        gloss_vi: row.glossVi,
      })),
    };
  }

  async searchConcepts(
    query: AdminCurationConceptQueryDto,
  ): Promise<{ data: Record<string, unknown>[] }> {
    const limit = Math.min(
      Math.max(query.limit ?? DEFAULT_SEARCH_LIMIT, 1),
      MAX_SEARCH_LIMIT,
    );
    const q = query.q.trim();
    const escaped = q
      .replaceAll('\\', '\\\\')
      .replaceAll('%', '\\%')
      .replaceAll('_', '\\_');
    const like = `%${escaped}%`;

    const rows = await this.prisma.$queryRaw<
      {
        id: bigint;
        glossEn: string | null;
        glossVi: string | null;
        pos: string | null;
        status: string;
        links: number;
      }[]
    >(Prisma.sql`
      SELECT c.id,
             c.gloss_en AS "glossEn",
             c.gloss_vi AS "glossVi",
             c.pos,
             c.status,
             (SELECT count(*)::int FROM core.sense_concept sc WHERE sc.concept_id = c.id) AS links
        FROM core.concept c
       WHERE c.id::text = ${q}
          OR coalesce(c.gloss_en, '') ILIKE ${like}
          OR coalesce(c.gloss_vi, '') ILIKE ${like}
       ORDER BY (c.id::text = ${q}) DESC, char_length(coalesce(c.gloss_en, '')), c.id
       LIMIT ${limit}
    `);

    return {
      data: rows.map((row) => ({
        concept_id: row.id.toString(),
        gloss_en: row.glossEn,
        gloss_vi: row.glossVi,
        pos: row.pos,
        status: row.status,
        links: row.links,
      })),
    };
  }

  async getGloss(glossId: bigint): Promise<Record<string, unknown>> {
    const [row] = await this.prisma.$queryRaw<
      (GlossRow & {
        lang: string;
        senseExternalId: string;
        senseNo: number;
        lemma: string;
        reading: string | null;
      })[]
    >(Prisma.sql`
      SELECT g.id,
             g.sense_id AS "senseId",
             g.text,
             g.is_machine AS "isMachine",
             g.quality,
             g.rank,
             g.reviewed_by AS "reviewedBy",
             u.email AS "reviewedByEmail",
             g.reviewed_at AS "reviewedAt",
             lg.code AS lang,
             s.external_id AS "senseExternalId",
             s.sense_no AS "senseNo",
             l.lemma,
             l.reading
        FROM core.sense_gloss g
        JOIN public.language lg ON lg.id = g.language_id
        JOIN core.sense s ON s.id = g.sense_id
        JOIN core.lexeme l ON l.id = s.lexeme_id
        LEFT JOIN app.users u ON u.id = g.reviewed_by
       WHERE g.id = ${glossId}
    `);
    if (!row) {
      throw new DomainException(
        'GLOSS_NOT_FOUND',
        'Không tìm thấy gloss',
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      ...toGlossResponse(row),
      language: row.lang,
      sense: {
        sense_id: row.senseId.toString(),
        external_id: row.senseExternalId,
        sense_no: row.senseNo,
        lemma: row.lemma,
        reading: row.reading,
      },
    };
  }

  async getSense(senseId: bigint): Promise<Record<string, unknown>> {
    const [sense] = await this.prisma.$queryRaw<SenseDetailRow[]>(Prisma.sql`
      SELECT s.id,
             s.external_id AS "externalId",
             s.sense_no AS "senseNo",
             s.definition,
             s.register,
             s.domain,
             s.is_primary AS "isPrimary",
             l.id AS "lexemeId",
             l.lemma,
             l.reading,
             l.romanization,
             l.pos,
             l.frequency_rank AS "frequencyRank"
        FROM core.sense s
        JOIN core.lexeme l ON l.id = s.lexeme_id
       WHERE s.id = ${senseId}
    `);
    if (!sense) {
      throw new DomainException(
        'SENSE_NOT_FOUND',
        'Không tìm thấy sense',
        HttpStatus.NOT_FOUND,
      );
    }

    const glossesVi = await this.loadGlosses(senseId, 'vi');
    const glossesEn = await this.loadGlosses(senseId, 'en');

    const mappings = await this.prisma.$queryRaw<MappingRow[]>(Prisma.sql`
      SELECT sc.concept_id AS "conceptId",
             sc.relation,
             sc.confidence,
             sc.method,
             sc.verified,
             sc.reviewed_by AS "reviewedBy",
             sc.reviewed_at AS "reviewedAt",
             sc.decided_at AS "decidedAt",
             src.code AS "sourceCode",
             mr.run_key AS "mappingRun",
             c.gloss_en AS "conceptGlossEn",
             c.gloss_vi AS "conceptGlossVi",
             c.status AS "conceptStatus",
             c.pos AS "conceptPos"
        FROM core.sense_concept sc
        JOIN core.concept c ON c.id = sc.concept_id
        LEFT JOIN public.source src ON src.id = sc.source_id
        LEFT JOIN core.mapping_run mr ON mr.id = sc.mapping_run_id
       WHERE sc.sense_id = ${senseId}
       ORDER BY (c.status = 'curated') DESC, sc.confidence DESC NULLS LAST, sc.concept_id
    `);

    const glossIdsText = glossesVi.map((gloss) => gloss.id.toString());
    const reports = glossIdsText.length
      ? await this.prisma.$queryRaw<ReportRow[]>(Prisma.sql`
          SELECT r.id,
                 r.target_kind AS "targetKind",
                 r.target_id AS "targetId",
                 r.issue,
                 r.comment,
                 r.status,
                 r.created_at AS "createdAt",
                 r.resolved_at AS "resolvedAt"
            FROM app.gloss_report r
           WHERE (r.target_kind = 'sense' AND r.target_id = ${senseId.toString()})
              OR (r.target_kind = 'sense_gloss' AND r.target_id = ANY(${glossIdsText}))
           ORDER BY r.created_at DESC
           LIMIT 10
        `)
      : [];

    return {
      sense: {
        id: sense.id.toString(),
        external_id: sense.externalId,
        sense_no: sense.senseNo,
        definition: sense.definition,
        register: sense.register,
        domain: sense.domain,
        is_primary: sense.isPrimary,
      },
      lexeme: {
        id: sense.lexemeId.toString(),
        lemma: sense.lemma,
        reading: sense.reading,
        romanization: sense.romanization,
        pos: sense.pos,
        frequency_rank: sense.frequencyRank,
      },
      glosses_vi: glossesVi.map(toGlossResponse),
      glosses_en: glossesEn.map(toGlossResponse),
      mappings: mappings.map((row) => ({
        concept_id: row.conceptId.toString(),
        relation: row.relation,
        confidence: row.confidence,
        method: row.method,
        verified: row.verified,
        source_code: row.sourceCode,
        mapping_run: row.mappingRun,
        reviewed_by: nullableId(row.reviewedBy),
        reviewed_at: row.reviewedAt?.toISOString() ?? null,
        decided_at: row.decidedAt?.toISOString() ?? null,
        concept: {
          gloss_en: row.conceptGlossEn,
          gloss_vi: row.conceptGlossVi,
          status: row.conceptStatus,
          pos: row.conceptPos,
        },
      })),
      reports: reports.map((row) => ({
        id: row.id.toString(),
        target_kind: row.targetKind,
        target_id: row.targetId,
        issue: row.issue,
        comment: row.comment,
        status: row.status,
        created_at: row.createdAt.toISOString(),
        resolved_at: row.resolvedAt?.toISOString() ?? null,
      })),
    };
  }

  private async loadGlosses(
    senseId: bigint,
    lang: string,
  ): Promise<GlossRow[]> {
    return this.prisma.$queryRaw<GlossRow[]>(Prisma.sql`
      SELECT g.id,
             g.sense_id AS "senseId",
             g.text,
             g.is_machine AS "isMachine",
             g.quality,
             g.rank,
             g.reviewed_by AS "reviewedBy",
             u.email AS "reviewedByEmail",
             g.reviewed_at AS "reviewedAt"
        FROM core.sense_gloss g
        JOIN public.language lg ON lg.id = g.language_id
        LEFT JOIN app.users u ON u.id = g.reviewed_by
       WHERE g.sense_id = ${senseId} AND lg.code = ${lang}
       ORDER BY g.rank, g.id
    `);
  }

  // ============================== WRITE ==============================

  async updateGloss(
    adminUserId: bigint,
    glossId: bigint,
    dto: UpdateCurationGlossDto,
  ): Promise<Record<string, unknown>> {
    if (
      dto.text === undefined &&
      dto.reviewed === undefined &&
      dto.quality === undefined
    ) {
      throw new DomainException(
        'NO_CHANGES',
        'Cần ít nhất một thay đổi (text/reviewed/quality)',
        HttpStatus.BAD_REQUEST,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<GlossRow[]>(Prisma.sql`
        SELECT g.id,
               g.sense_id AS "senseId",
               g.text,
               g.is_machine AS "isMachine",
               g.quality,
               g.rank,
               g.reviewed_by AS "reviewedBy",
               g.reviewed_at AS "reviewedAt"
          FROM core.sense_gloss g
         WHERE g.id = ${glossId}
         FOR UPDATE
      `);
      const current = rows[0];
      if (!current) {
        throw new DomainException(
          'GLOSS_NOT_FOUND',
          'Không tìm thấy gloss',
          HttpStatus.NOT_FOUND,
        );
      }

      const sets: Prisma.Sql[] = [];
      const changes: Record<string, unknown> = {};

      if (dto.text !== undefined && dto.text !== current.text) {
        sets.push(Prisma.sql`text = ${dto.text}`);
        changes.text = { from: current.text, to: dto.text };
        if (current.isMachine) {
          sets.push(Prisma.sql`is_machine = false`);
          changes.is_machine = { from: true, to: false };
        }
      }
      if (dto.reviewed === true && current.reviewedBy === null) {
        sets.push(
          Prisma.sql`reviewed_by = ${adminUserId}, reviewed_at = now()`,
        );
        changes.reviewed = { from: null, to: adminUserId.toString() };
      } else if (dto.reviewed === false && current.reviewedBy !== null) {
        sets.push(Prisma.sql`reviewed_by = NULL, reviewed_at = NULL`);
        changes.reviewed = { from: current.reviewedBy.toString(), to: null };
      }
      if (dto.quality !== undefined && dto.quality !== current.quality) {
        sets.push(Prisma.sql`quality = ${dto.quality}`);
        changes.quality = { from: current.quality, to: dto.quality };
      }

      if (sets.length === 0) {
        throw new DomainException(
          'NO_CHANGES',
          'Không có thay đổi nào so với hiện tại',
          HttpStatus.BAD_REQUEST,
        );
      }

      const [row] = await tx.$queryRaw<GlossRow[]>(Prisma.sql`
        UPDATE core.sense_gloss
           SET ${Prisma.join(sets, ', ')}
         WHERE id = ${glossId}
        RETURNING id, sense_id AS "senseId", text, is_machine AS "isMachine",
                  quality, rank, reviewed_by AS "reviewedBy", reviewed_at AS "reviewedAt"
      `);

      await this.audit.record(tx, {
        adminUserId,
        action: 'curation.gloss.update',
        targetKind: 'sense_gloss',
        targetId: glossId.toString(),
        payload: { sense_id: current.senseId.toString(), changes },
      });
      return row;
    });

    return toGlossResponse(updated);
  }

  async createGloss(
    adminUserId: bigint,
    senseId: bigint,
    dto: CreateCurationGlossDto,
  ): Promise<Record<string, unknown>> {
    const created = await this.prisma.$transaction(async (tx) => {
      const sense = await tx.$queryRaw<{ id: bigint }[]>(Prisma.sql`
        SELECT id FROM core.sense WHERE id = ${senseId}
      `);
      if (sense.length === 0) {
        throw new DomainException(
          'SENSE_NOT_FOUND',
          'Không tìm thấy sense',
          HttpStatus.NOT_FOUND,
        );
      }
      const [lang] = await tx.$queryRaw<{ id: number }[]>(Prisma.sql`
        SELECT id FROM public.language WHERE code = 'vi'
      `);
      const sourceId = await ensureAdminSource(tx);

      const [row] = await tx.$queryRaw<GlossRow[]>(Prisma.sql`
        INSERT INTO core.sense_gloss(sense_id, language_id, text, is_machine, rank, reviewed_by, reviewed_at, source_id)
        SELECT ${senseId},
               ${lang.id},
               ${dto.text},
               false,
               COALESCE((SELECT max(rank) FROM core.sense_gloss WHERE sense_id = ${senseId} AND language_id = ${lang.id}), 0) + 1,
               ${adminUserId},
               now(),
               ${sourceId}
        RETURNING id, sense_id AS "senseId", text, is_machine AS "isMachine",
                  quality, rank, reviewed_by AS "reviewedBy", reviewed_at AS "reviewedAt"
      `);

      await this.audit.record(tx, {
        adminUserId,
        action: 'curation.gloss.create',
        targetKind: 'sense_gloss',
        targetId: row.id.toString(),
        payload: { sense_id: senseId.toString(), text: dto.text },
      });
      return row;
    });

    return toGlossResponse(created);
  }

  async deleteGloss(
    adminUserId: bigint,
    glossId: bigint,
  ): Promise<{ deleted: true; id: string }> {
    const current = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<GlossRow[]>(Prisma.sql`
        SELECT g.id,
               g.sense_id AS "senseId",
               g.text,
               g.is_machine AS "isMachine",
               g.quality,
               g.rank,
               g.reviewed_by AS "reviewedBy",
               g.reviewed_at AS "reviewedAt"
          FROM core.sense_gloss g
         WHERE g.id = ${glossId}
         FOR UPDATE
      `);
      const row = rows[0];
      if (!row) {
        throw new DomainException(
          'GLOSS_NOT_FOUND',
          'Không tìm thấy gloss',
          HttpStatus.NOT_FOUND,
        );
      }
      await tx.$executeRaw(Prisma.sql`
        DELETE FROM core.sense_gloss WHERE id = ${glossId}
      `);
      await this.audit.record(tx, {
        adminUserId,
        action: 'curation.gloss.delete',
        targetKind: 'sense_gloss',
        targetId: glossId.toString(),
        payload: {
          sense_id: row.senseId.toString(),
          text: row.text,
          is_machine: row.isMachine,
          reviewed_by: nullableId(row.reviewedBy),
        },
      });
      return row;
    });

    return { deleted: true, id: current.id.toString() };
  }

  async addMapping(
    adminUserId: bigint,
    senseId: bigint,
    dto: CreateCurationMappingDto,
  ): Promise<Record<string, unknown>> {
    const conceptId = parsePositivePostgresBigInt(dto.concept_id, 'ID concept');
    const relation = dto.relation ?? 'exact';

    await this.prisma.$transaction(async (tx) => {
      const sense = await tx.$queryRaw<{ id: bigint }[]>(Prisma.sql`
        SELECT id FROM core.sense WHERE id = ${senseId}
      `);
      if (sense.length === 0) {
        throw new DomainException(
          'SENSE_NOT_FOUND',
          'Không tìm thấy sense',
          HttpStatus.NOT_FOUND,
        );
      }
      const concept = await tx.$queryRaw<{ id: bigint }[]>(Prisma.sql`
        SELECT id FROM core.concept WHERE id = ${conceptId}
      `);
      if (concept.length === 0) {
        throw new DomainException(
          'CONCEPT_NOT_FOUND',
          'Không tìm thấy concept',
          HttpStatus.NOT_FOUND,
        );
      }
      const sourceId = await ensureAdminSource(tx);

      const rows = await tx.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
        INSERT INTO core.sense_concept(sense_id, concept_id, relation, confidence, method, verified, source_id, decided_at, reviewed_by, reviewed_at)
        VALUES (${senseId}, ${conceptId}, ${relation}, 1.0, 'admin', true, ${sourceId}, now(), ${adminUserId}, now())
        ON CONFLICT (sense_id, concept_id) DO NOTHING
        RETURNING sense_id, concept_id, relation, confidence, method, verified, decided_at
      `);
      const inserted = rows[0];
      if (!inserted) {
        throw new DomainException(
          'MAPPING_EXISTS',
          'Sense đã có nối với concept này',
          HttpStatus.CONFLICT,
        );
      }

      await this.audit.record(tx, {
        adminUserId,
        action: 'curation.mapping.create',
        targetKind: 'sense_concept',
        targetId: `${senseId.toString()}:${conceptId.toString()}`,
        payload: {
          sense_id: senseId.toString(),
          concept_id: conceptId.toString(),
          relation,
        },
      });
      return inserted;
    });

    this.queueServeRefresh();
    return {
      sense_id: senseId.toString(),
      concept_id: conceptId.toString(),
      relation,
      confidence: 1,
      method: 'admin',
      verified: true,
    };
  }

  async deleteMapping(
    adminUserId: bigint,
    senseId: bigint,
    conceptId: bigint,
  ): Promise<{ deleted: true; sense_id: string; concept_id: string }> {
    const removed = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
        DELETE FROM core.sense_concept
         WHERE sense_id = ${senseId} AND concept_id = ${conceptId}
        RETURNING sense_id, concept_id, relation, confidence, method, verified, source_id
      `);
      const row = rows[0];
      if (!row) {
        throw new DomainException(
          'MAPPING_NOT_FOUND',
          'Sense chưa có nối với concept này',
          HttpStatus.NOT_FOUND,
        );
      }
      await this.audit.record(tx, {
        adminUserId,
        action: 'curation.mapping.delete',
        targetKind: 'sense_concept',
        targetId: `${senseId.toString()}:${conceptId.toString()}`,
        payload: {
          sense_id: senseId.toString(),
          concept_id: conceptId.toString(),
          removed: row,
        },
      });
      return true;
    });
    void removed;

    this.queueServeRefresh();
    return {
      deleted: true,
      sense_id: senseId.toString(),
      concept_id: conceptId.toString(),
    };
  }

  async updateConceptStatus(
    adminUserId: bigint,
    conceptId: bigint,
    dto: UpdateCurationConceptDto,
  ): Promise<{ id: string; status: string }> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: bigint; status: string }[]>(
        Prisma.sql`
          SELECT id, status FROM core.concept WHERE id = ${conceptId} FOR UPDATE
        `,
      );
      const current = rows[0];
      if (!current) {
        throw new DomainException(
          'CONCEPT_NOT_FOUND',
          'Không tìm thấy concept',
          HttpStatus.NOT_FOUND,
        );
      }
      if (current.status === dto.status) {
        throw new DomainException(
          'NO_CHANGES',
          'Trạng thái không đổi',
          HttpStatus.BAD_REQUEST,
        );
      }
      const [row] = await tx.$queryRaw<{ id: bigint; status: string }[]>(
        Prisma.sql`
          UPDATE core.concept SET status = ${dto.status}
           WHERE id = ${conceptId}
          RETURNING id, status
        `,
      );
      await this.audit.record(tx, {
        adminUserId,
        action: 'curation.concept.status',
        targetKind: 'concept',
        targetId: conceptId.toString(),
        payload: { from: current.status, to: dto.status },
      });
      return row;
    });

    this.queueServeRefresh();
    return { id: updated.id.toString(), status: updated.status };
  }

  // ============================== SERVE REFRESH ==============================

  /** Refresh nền, gộp nhiều mutation liên tiếp thành một lần refresh. */
  queueServeRefresh(): void {
    if (this.refreshRunning) {
      this.refreshQueued = true;
      return;
    }
    this.refreshRunning = true;
    void this.drainServeRefresh();
  }

  private async drainServeRefresh(): Promise<void> {
    try {
      do {
        this.refreshQueued = false;
        await this.refreshServePair();
      } while (this.refreshQueued);
    } finally {
      this.refreshRunning = false;
    }
  }

  async refreshServePair(): Promise<'refreshed' | 'failed'> {
    try {
      await this.prisma.$executeRawUnsafe(
        'REFRESH MATERIALIZED VIEW CONCURRENTLY serve.sense_pair',
      );
      this.logger.log('Đã refresh serve.sense_pair');
      return 'refreshed';
    } catch (error) {
      this.logger.error(
        `Refresh serve.sense_pair lỗi: ${(error as Error).message}`,
      );
      return 'failed';
    }
  }

  /** Kích hoạt refresh đồng bộ (chờ kết quả) — dùng cho endpoint admin thủ công. */
  async triggerServeRefresh(): Promise<{ status: string }> {
    const status = await this.refreshServePair();
    return { status };
  }
}

async function ensureAdminSource(
  tx: Prisma.TransactionClient,
): Promise<number> {
  const rows = await tx.$queryRaw<{ id: number }[]>(Prisma.sql`
    SELECT id FROM public.source WHERE code = ${ADMIN_SOURCE_CODE}
  `);
  if (rows.length > 0) {
    return rows[0].id;
  }
  const [created] = await tx.$queryRaw<{ id: number }[]>(Prisma.sql`
    INSERT INTO public.source(id, code, name, license, attribution, version)
    SELECT COALESCE(max(id), 0) + 1,
           ${ADMIN_SOURCE_CODE},
           'Langoo admin curation (M14)',
           'nội bộ',
           'Admin Langoo nhập/sửa thủ công theo báo cáo người dùng',
           'v1'
      FROM public.source
    RETURNING id
  `);
  return created.id;
}

function nullableId(value: bigint | null): string | null {
  return value === null ? null : value.toString();
}

function toGlossResponse(row: GlossRow): Record<string, unknown> {
  return {
    id: row.id.toString(),
    sense_id: row.senseId.toString(),
    text: row.text,
    is_machine: row.isMachine,
    quality: row.quality,
    rank: row.rank,
    reviewed_by: nullableId(row.reviewedBy),
    reviewed_by_email: row.reviewedByEmail ?? null,
    reviewed_at: row.reviewedAt?.toISOString() ?? null,
  };
}

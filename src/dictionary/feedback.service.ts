import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException } from '../common/errors/domain.exception';
import { LanguageRepository } from '../db/repositories/language.repository';
import { PrismaService } from '../db/prisma.service';
import { CreateGlossReportDto } from './dto/create-gloss-report.dto';
import { GlossReportResponse } from './types/dictionary.types';

interface GlossReportRow {
  id: bigint;
  targetKind: string;
  targetId: string;
  languageId: number | null;
  issue: string;
  comment: string | null;
  status: string;
  createdAt: Date;
}

/**
 * Kênh báo lỗi gloss của người học (`app.gloss_report`).
 * Đây là cơ chế kiểm duyệt chính khi chưa có người duyệt nội bộ (CONTEXT §4.5).
 */
@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly languages: LanguageRepository,
  ) {}

  async create(
    userId: bigint,
    dto: CreateGlossReportDto,
  ): Promise<GlossReportResponse> {
    const targetId = dto.target_id.trim();
    if (targetId.length === 0) {
      throw new DomainException(
        'VALIDATION_FAILED',
        'target_id không được để trống',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (dto.language_id !== undefined) {
      const existing = await this.languages.findExistingIds([dto.language_id]);
      if (!existing.has(dto.language_id)) {
        throw new DomainException(
          'LANGUAGE_NOT_FOUND',
          `Ngôn ngữ không tồn tại: ${dto.language_id}`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const report = await this.prisma.glossReport.create({
      data: {
        userId,
        targetKind: dto.target_kind,
        targetId,
        languageId: dto.language_id ?? null,
        issue: dto.issue,
        comment: dto.comment ?? null,
      },
    });

    return toGlossReportResponse(report);
  }
}

function toGlossReportResponse(row: GlossReportRow): GlossReportResponse {
  return {
    id: row.id.toString(),
    target_kind: row.targetKind,
    target_id: row.targetId,
    language_id: row.languageId,
    issue: row.issue,
    comment: row.comment,
    status: row.status,
    created_at: row.createdAt.toISOString(),
  };
}

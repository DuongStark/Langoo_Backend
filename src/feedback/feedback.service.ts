import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { DomainException } from '../common/errors/domain.exception';
import {
  decodeUuidTimeCursor,
  encodeTimeIdCursor,
} from '../common/pagination/time-cursor';
import { PrismaService } from '../db/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { AdminAuditService } from '../admin/admin-audit.service';
import {
  AdminFeedbackQueryDto,
  CreateFeedbackDto,
  MyFeedbackQueryDto,
  UpdateFeedbackDto,
} from './dto/feedback.dto';
import {
  AdminFeedbackResponse,
  FeedbackListResponse,
  FeedbackResponse,
} from './types/feedback.types';
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  MIME_EXTENSION,
  sniffImageMime,
  STORAGE_SERVICE,
  StorageService,
} from '../storage/storage.service';

const DEFAULT_PAGE = 20;
const MAX_PAGE = 100;

interface FeedbackRow {
  id: string;
  category: string;
  content: string;
  status: string;
  adminNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  attachments?: { id: string; mime: string; sizeBytes: number }[];
}

/**
 * Feedback người dùng (M13): text + tối đa 3 ảnh ≤5MB (kiểm magic bytes),
 * lưu app.feedback / app.feedback_attachment, ảnh qua StorageService.
 */
@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  // ---------------------------------------------------------------- user
  async create(
    userId: bigint,
    dto: CreateFeedbackDto,
    files: Express.Multer.File[],
  ): Promise<FeedbackResponse> {
    const uploads = this.prepareAttachments(userId, files);
    const storedKeys: string[] = [];
    try {
      for (const upload of uploads) {
        await this.storage.put(upload.key, upload.buffer, upload.mime);
        storedKeys.push(upload.key);
      }
    } catch (error) {
      await this.cleanup(storedKeys);
      this.logger.warn(
        `Lưu ảnh feedback lỗi: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown'}`,
      );
      throw new DomainException(
        'STORAGE_UNAVAILABLE',
        'Không lưu được ảnh đính kèm, vui lòng thử lại sau',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const feedbackId = uuidv7();
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const feedback = await tx.feedback.create({
          data: {
            id: feedbackId,
            userId,
            category: dto.category,
            content: dto.content,
          },
        });
        if (uploads.length > 0) {
          await tx.feedbackAttachment.createMany({
            data: uploads.map((upload) => ({
              id: upload.id,
              feedbackId,
              storageKey: upload.key,
              mime: upload.mime,
              sizeBytes: upload.size,
            })),
          });
        }
        return feedback;
      });
      return toFeedbackResponse({
        ...created,
        attachments: uploads.map((upload) => ({
          id: upload.id,
          mime: upload.mime,
          sizeBytes: upload.size,
        })),
      });
    } catch (error) {
      await this.cleanup(storedKeys);
      throw error;
    }
  }

  async listMine(
    userId: bigint,
    query: MyFeedbackQueryDto,
  ): Promise<FeedbackListResponse<FeedbackResponse>> {
    const limit = clampLimit(query.limit);
    const rows = await this.prisma.feedback.findMany({
      where: {
        userId,
        ...(this.cursorCondition(query.cursor) ?? {}),
      },
      include: { attachments: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasNext = rows.length > limit;
    const page = hasNext ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    return {
      data: page.map((row) => toFeedbackResponse(row)),
      next_cursor:
        hasNext && last
          ? encodeTimeIdCursor({ createdAt: last.createdAt, id: last.id })
          : null,
    };
  }

  // --------------------------------------------------------------- admin
  async adminList(
    query: AdminFeedbackQueryDto,
  ): Promise<FeedbackListResponse<AdminFeedbackResponse>> {
    const limit = clampLimit(query.limit);
    const rows = await this.prisma.feedback.findMany({
      where: {
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.category === undefined ? {} : { category: query.category }),
        ...(this.cursorCondition(query.cursor) ?? {}),
      },
      include: {
        attachments: true,
        user: { select: { id: true, email: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasNext = rows.length > limit;
    const page = hasNext ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    return {
      data: page.map((row) => toAdminFeedbackResponse(row)),
      next_cursor:
        hasNext && last
          ? encodeTimeIdCursor({ createdAt: last.createdAt, id: last.id })
          : null,
    };
  }

  async adminGet(feedbackId: string): Promise<AdminFeedbackResponse> {
    const row = await this.prisma.feedback.findUnique({
      where: { id: feedbackId },
      include: {
        attachments: true,
        user: { select: { id: true, email: true } },
      },
    });
    if (!row) {
      throw feedbackNotFound();
    }
    return toAdminFeedbackResponse(row);
  }

  async adminUpdate(
    adminUserId: bigint,
    feedbackId: string,
    dto: UpdateFeedbackDto,
  ): Promise<AdminFeedbackResponse> {
    const existing = await this.prisma.feedback.findUnique({
      where: { id: feedbackId },
      select: { id: true },
    });
    if (!existing) {
      throw feedbackNotFound();
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.feedback.update({
        where: { id: feedbackId },
        data: {
          status: dto.status,
          ...(dto.admin_note === undefined
            ? {}
            : { adminNote: dto.admin_note === '' ? null : dto.admin_note }),
        },
        include: {
          attachments: true,
          user: { select: { id: true, email: true } },
        },
      });
      await this.audit.record(tx, {
        adminUserId,
        action: 'feedback.update',
        targetKind: 'feedback',
        targetId: feedbackId,
        payload: { status: dto.status },
      });
      return row;
    });
    return toAdminFeedbackResponse(updated);
  }

  /** Trả nội dung ảnh cho admin (không public URL). */
  async getAttachment(
    feedbackId: string,
    attachmentId: string,
  ): Promise<{ buffer: Buffer; mime: string }> {
    const attachment = await this.prisma.feedbackAttachment.findFirst({
      where: { id: attachmentId, feedbackId },
    });
    if (!attachment) {
      throw new DomainException(
        'ATTACHMENT_NOT_FOUND',
        'Không tìm thấy ảnh đính kèm',
        HttpStatus.NOT_FOUND,
      );
    }
    const buffer = await this.storage.get(attachment.storageKey);
    if (buffer === null) {
      throw new DomainException(
        'ATTACHMENT_NOT_FOUND',
        'Ảnh không còn tồn tại trong kho lưu trữ',
        HttpStatus.NOT_FOUND,
      );
    }
    return { buffer, mime: attachment.mime };
  }

  // ----------------------------------------------------------------- util
  private prepareAttachments(
    userId: bigint,
    files: Express.Multer.File[],
  ): {
    id: string;
    key: string;
    mime: string;
    size: number;
    buffer: Buffer;
  }[] {
    if (files.length > MAX_ATTACHMENTS) {
      throw attachmentInvalid(`Tối đa ${MAX_ATTACHMENTS} ảnh`);
    }
    const seen = new Set<string>();
    return files.map((file) => {
      const buffer = file.buffer;
      if (buffer === undefined || buffer.length === 0) {
        throw attachmentInvalid('Ảnh rỗng');
      }
      if (buffer.length > MAX_ATTACHMENT_BYTES) {
        throw attachmentInvalid('Ảnh vượt quá 5MB');
      }
      const mime = sniffImageMime(buffer);
      if (mime === null) {
        throw attachmentInvalid('Chỉ nhận ảnh JPEG/PNG/WebP hợp lệ');
      }
      const id = uuidv7();
      if (seen.has(id)) {
        throw attachmentInvalid('Ảnh trùng lặp');
      }
      seen.add(id);
      return {
        id,
        key: `feedback/${userId.toString()}/${id}.${MIME_EXTENSION[mime]}`,
        mime,
        size: buffer.length,
        buffer,
      };
    });
  }

  private async cleanup(keys: string[]): Promise<void> {
    for (const key of keys) {
      try {
        await this.storage.delete(key);
      } catch {
        // Dọn tệp là best-effort — không che lỗi gốc.
      }
    }
  }

  private cursorCondition(
    raw: string | undefined,
  ): Prisma.FeedbackWhereInput | null {
    if (raw === undefined || raw === '') {
      return null;
    }
    const cursor = decodeUuidTimeCursor(raw);
    return {
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ],
    };
  }
}

function feedbackNotFound(): DomainException {
  return new DomainException(
    'FEEDBACK_NOT_FOUND',
    'Không tìm thấy feedback',
    HttpStatus.NOT_FOUND,
  );
}

function attachmentInvalid(reason: string): DomainException {
  return new DomainException(
    'ATTACHMENT_INVALID',
    `Ảnh đính kèm không hợp lệ: ${reason}`,
    HttpStatus.BAD_REQUEST,
  );
}

function clampLimit(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_PAGE;
  }
  return Math.min(Math.max(value, 1), MAX_PAGE);
}

function toFeedbackResponse(row: FeedbackRow): FeedbackResponse {
  return {
    id: row.id,
    category: row.category,
    content: row.content,
    status: row.status,
    admin_note: row.adminNote,
    attachments: (row.attachments ?? []).map((attachment) => ({
      id: attachment.id,
      mime: attachment.mime,
      size_bytes: attachment.sizeBytes,
    })),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function toAdminFeedbackResponse(row: {
  id: string;
  category: string;
  content: string;
  status: string;
  adminNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  attachments: { id: string; mime: string; sizeBytes: number }[];
  user: { id: bigint; email: string };
}): AdminFeedbackResponse {
  return {
    ...toFeedbackResponse(row),
    user: { id: row.user.id.toString(), email: row.user.email },
  };
}

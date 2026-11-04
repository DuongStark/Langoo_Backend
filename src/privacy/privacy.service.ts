import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v7 as uuidv7 } from 'uuid';
import { DomainException } from '../common/errors/domain.exception';
import { PrismaService } from '../db/prisma.service';
import {
  PrivacyEvent,
  PrivacyRequest,
  TermsAcceptance,
} from '../generated/prisma/client';
import { lockUser } from '../users/user-lock';
import {
  AdminPrivacyRequestListResponse,
  LegalManifestResponse,
  PRIVACY_PURPOSES,
  PrivacyEventInput,
  PrivacyEventResponse,
  PrivacyRequestInput,
  PrivacyRequestResponse,
  PrivacyRequestListResponse,
  PrivacyStateResponse,
  UpdatePrivacyRequestInput,
  TermsAcceptanceInput,
  TermsAcceptanceResponse,
  TermsStateResponse,
} from './privacy.dto';

export const TERMS_VERSION = '2026-11-04-v1';
export const PRIVACY_NOTICE_VERSION = '2026-11-03-v1';
const TARGET_DAYS: Record<string, number> = {
  access: 10,
  rectification: 10,
  erasure: 20,
  restriction: 15,
  objection: 15,
};

@Injectable()
export class PrivacyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  manifest(): LegalManifestResponse {
    return {
      terms_version: TERMS_VERSION,
      terms_url: 'https://langoo.org/terms',
      notice_version: PRIVACY_NOTICE_VERSION,
      notice_url: 'https://langoo.org/privacy',
      ai_consent_required: this.required(),
      age_policy: {
        minimum_age: null,
        representative_verification: 'not_implemented',
      },
      purposes: [
        {
          purpose_id: 'ai_assistance',
          description_vi:
            'Cho phép gửi tin nhắn, ảnh đính kèm và ngữ cảnh học tập cần thiết tới nhà cung cấp AI để trả lời hoặc tạo quiz.',
        },
        {
          purpose_id: 'online_translation',
          description_vi:
            'Cho phép gửi đoạn chữ cần dịch tới dịch vụ dịch trực tuyến. Tệp PDF/ảnh OCR gốc không thuộc phạm vi lựa chọn này.',
        },
        {
          purpose_id: 'analytics',
          description_vi:
            'Cho phép thống kê sử dụng tùy chọn sau khi đã loại thông tin cá nhân khỏi URL và sự kiện.',
        },
      ],
      rights_contact_email: 'starkduong@gmail.com',
    };
  }

  private required(): boolean {
    return this.config.get<boolean>('PRIVACY_AI_CONSENT_REQUIRED') === true;
  }

  private async safe<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof DomainException) throw error;
      throw new DomainException(
        'PRIVACY_UNAVAILABLE',
        'Không truy cập được dữ liệu quyền riêng tư, vui lòng thử lại',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  async termsState(userId: bigint): Promise<TermsStateResponse> {
    return this.safe(async () => {
      const latest = await this.prisma.termsAcceptance.findFirst({
        where: { userId },
        orderBy: { id: 'desc' },
      });
      return {
        terms_version: TERMS_VERSION,
        status:
          latest?.termsVersion === TERMS_VERSION ? 'accepted' : 'needs_action',
        latest_acceptance: latest ? termsResponse(latest) : null,
      };
    });
  }

  async acceptTerms(
    userId: bigint,
    input: TermsAcceptanceInput,
  ): Promise<TermsAcceptanceResponse> {
    return this.safe(() =>
      this.prisma.$transaction(async (tx) => {
        await lockUser(tx, userId);
        const existing = await tx.termsAcceptance.findUnique({
          where: { userId_requestId: { userId, requestId: input.request_id } },
        });
        if (existing) {
          if (existing.termsVersion !== input.terms_version) {
            throw new DomainException(
              'TERMS_REQUEST_CONFLICT',
              'Mã yêu cầu đã được dùng với phiên bản điều khoản khác',
              HttpStatus.CONFLICT,
            );
          }
          return termsResponse(existing);
        }
        if (input.terms_version !== TERMS_VERSION) {
          throw new DomainException(
            'TERMS_VERSION_OUTDATED',
            'Điều khoản đã thay đổi; vui lòng đọc và lựa chọn lại',
            HttpStatus.CONFLICT,
          );
        }
        return termsResponse(
          await tx.termsAcceptance.create({
            data: {
              userId,
              requestId: input.request_id,
              termsVersion: input.terms_version,
            },
          }),
        );
      }),
    );
  }

  async state(userId: bigint): Promise<PrivacyStateResponse> {
    return this.safe(async () => ({
      notice_version: PRIVACY_NOTICE_VERSION,
      ai_consent_required: this.required(),
      choices: await Promise.all(
        PRIVACY_PURPOSES.map(async (purposeId) => {
          const row = await this.prisma.privacyEvent.findFirst({
            where: { userId, purposeId },
            orderBy: { id: 'desc' },
          });
          return {
            purpose_id: purposeId,
            state:
              row?.action === 'withdraw'
                ? 'withdrawn'
                : row?.noticeVersion === PRIVACY_NOTICE_VERSION
                  ? 'granted'
                  : 'needs_action',
          };
        }),
      ),
    }));
  }

  async assertAiAllowed(userId: bigint): Promise<void> {
    await this.safe(async () => {
      const row = await this.prisma.privacyEvent.findFirst({
        where: { userId, purposeId: 'ai_assistance' },
        orderBy: { id: 'desc' },
      });
      if (
        row?.action === 'withdraw' ||
        (this.required() &&
          !(
            row?.action === 'grant' &&
            row.noticeVersion === PRIVACY_NOTICE_VERSION
          ))
      ) {
        throw new DomainException(
          'PRIVACY_CONSENT_REQUIRED',
          'Cần xác nhận lựa chọn chia sẻ dữ liệu với AI',
          HttpStatus.FORBIDDEN,
        );
      }
    });
  }

  async recordEvent(
    userId: bigint,
    input: PrivacyEventInput,
  ): Promise<PrivacyEventResponse> {
    return this.safe(() =>
      this.prisma.$transaction(async (tx) => {
        await lockUser(tx, userId);
        const old = await tx.privacyEvent.findUnique({
          where: { userId_requestId: { userId, requestId: input.request_id } },
        });
        if (old) {
          if (
            old.purposeId !== input.purpose_id ||
            old.action !== input.action ||
            old.noticeVersion !== input.notice_version
          )
            throw conflict();
          return eventResponse(old);
        }
        // Withdrawal remains possible even when the notice has changed.
        if (
          input.action === 'grant' &&
          input.notice_version !== PRIVACY_NOTICE_VERSION
        ) {
          throw new DomainException(
            'PRIVACY_NOTICE_OUTDATED',
            'Vui lòng đọc phiên bản thông báo hiện tại',
            HttpStatus.CONFLICT,
          );
        }
        const row = await tx.privacyEvent.create({
          data: {
            userId,
            requestId: input.request_id,
            purposeId: input.purpose_id,
            action: input.action,
            noticeVersion: input.notice_version,
          },
        });
        return eventResponse(row);
      }),
    );
  }

  async createRequest(
    userId: bigint,
    input: PrivacyRequestInput,
  ): Promise<PrivacyRequestResponse> {
    return this.safe(() =>
      this.prisma.$transaction(async (tx) => {
        await lockUser(tx, userId);
        const old = await tx.privacyRequest.findUnique({
          where: { userId_requestId: { userId, requestId: input.request_id } },
        });
        if (old) {
          if (old.kind !== input.kind) throw conflict();
          return requestResponse(old);
        }
        const now = new Date();
        const targetAt = new Date(
          now.getTime() + TARGET_DAYS[input.kind] * 86400000,
        );
        return requestResponse(
          await tx.privacyRequest.create({
            data: {
              id: uuidv7(),
              userId,
              requestId: input.request_id,
              kind: input.kind,
              receivedAt: now,
              acknowledgedAt: now,
              targetAt,
              updatedAt: now,
            },
          }),
        );
      }),
    );
  }

  async getRequest(
    userId: bigint,
    id: string,
  ): Promise<PrivacyRequestResponse> {
    return this.safe(async () => {
      const row = await this.prisma.privacyRequest.findFirst({
        where: { id, userId },
      });
      if (!row) throw notFound();
      return requestResponse(row);
    });
  }

  async listRequests(
    userId: bigint | null,
    cursor?: string,
  ): Promise<PrivacyRequestListResponse> {
    return this.safe(async () => {
      const rows = await this.prisma.privacyRequest.findMany({
        where: {
          ...(userId === null ? {} : { userId }),
          ...(cursor ? { id: { lt: cursor } } : {}),
        },
        orderBy: { id: 'desc' },
        take: 51,
      });
      const page = rows.slice(0, 50);
      return {
        data: page.map(requestResponse),
        next_cursor: rows.length > 50 ? page[page.length - 1].id : null,
      };
    });
  }

  async listAdminRequests(
    cursor?: string,
  ): Promise<AdminPrivacyRequestListResponse> {
    return this.safe(async () => {
      const rows = await this.prisma.privacyRequest.findMany({
        where: cursor ? { id: { lt: cursor } } : {},
        orderBy: { id: 'desc' },
        take: 51,
      });
      const page = rows.slice(0, 50);
      return {
        data: page.map((row) => ({
          ...requestResponse(row),
          user_id: String(row.userId),
        })),
        next_cursor: rows.length > 50 ? page[page.length - 1].id : null,
      };
    });
  }

  async updateRequest(
    adminId: bigint,
    id: string,
    input: UpdatePrivacyRequestInput,
  ): Promise<PrivacyRequestResponse> {
    if (
      (input.status === 'rejected') !==
      (input.rejection_reason !== undefined)
    ) {
      throw new DomainException(
        'VALIDATION_FAILED',
        'Chỉ yêu cầu bị từ chối mới có mã lý do',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.safe(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM app.privacy_request WHERE id = ${id}::uuid FOR UPDATE`;
        const row = await tx.privacyRequest.findUnique({ where: { id } });
        if (!row) throw notFound();
        if (
          ['rejected', 'completed'].includes(row.status) &&
          input.status !== row.status
        )
          throw conflict();
        const updated = await tx.privacyRequest.update({
          where: { id },
          data: {
            status: input.status,
            rejectionReason: input.rejection_reason ?? null,

            updatedBy: adminId,
            updatedAt: new Date(),
          },
        });
        await tx.adminAuditLog.create({
          data: {
            adminUserId: adminId,
            action: 'privacy.request.update',
            targetKind: 'privacy_request',
            targetId: id,
            payload: {
              before: row.status,
              after: updated.status,
              rejection_reason: updated.rejectionReason,
              resolution_reference: updated.resolutionReference,
            },
          },
        });
        return requestResponse(updated);
      }),
    );
  }
}
function conflict(): DomainException {
  return new DomainException(
    'PRIVACY_REQUEST_CONFLICT',
    'Mã yêu cầu đã được dùng với nội dung khác hoặc trạng thái không hợp lệ',
    HttpStatus.CONFLICT,
  );
}
function notFound(): DomainException {
  return new DomainException(
    'PRIVACY_REQUEST_NOT_FOUND',
    'Không tìm thấy yêu cầu',
    HttpStatus.NOT_FOUND,
  );
}
function eventResponse(row: PrivacyEvent): PrivacyEventResponse {
  return {
    id: String(row.id),
    request_id: row.requestId,
    purpose_id: row.purposeId,
    action: row.action,
    notice_version: row.noticeVersion,
    created_at: row.createdAt.toISOString(),
  };
}
function requestResponse(row: PrivacyRequest): PrivacyRequestResponse {
  return {
    id: row.id,
    request_id: row.requestId,
    kind: row.kind,
    status: row.status,
    received_at: row.receivedAt.toISOString(),
    acknowledged_at: row.acknowledgedAt.toISOString(),
    target_at: row.targetAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    rejection_reason: row.rejectionReason,
    resolution_reference: row.resolutionReference,
  };
}

function termsResponse(row: TermsAcceptance): TermsAcceptanceResponse {
  return {
    id: String(row.id),
    request_id: row.requestId,
    terms_version: row.termsVersion,
    accepted_at: row.acceptedAt.toISOString(),
  };
}

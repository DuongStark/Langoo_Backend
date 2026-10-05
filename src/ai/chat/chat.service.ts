import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v7 as uuidv7 } from 'uuid';
import { DomainException } from '../../common/errors/domain.exception';
import { parsePositivePostgresBigInt } from '../../common/ids/postgres-id';
import { localDateString } from '../../common/time/timezone';
import { LanguageRepository } from '../../db/repositories/language.repository';
import { PrismaService } from '../../db/prisma.service';
import { DictionaryService } from '../../dictionary/dictionary.service';
import { Prisma } from '../../generated/prisma/client';
import { DEFAULT_TIMEZONE } from '../../users/settings.constants';
import {
  AI_CHAT_PROVIDER,
  AiChatProvider,
  AiSenseContext,
} from '../providers/ai-chat.provider';
import { aiChatModel } from '../providers/ai-chat-provider.factory';
import { AiDbClient, AiUsageService } from '../usage/ai-usage.service';
import {
  decodeChatMessageCursor,
  decodeChatSessionCursor,
  encodeChatMessageCursor,
  encodeChatSessionCursor,
} from './chat-cursor';
import {
  buildChatMessages,
  CHAT_PROMPT_VERSION,
  ChatScenario,
} from './context-builder';
import { SendChatMessageDto } from './dto/chat.dto';
import {
  ChatMessageResponse,
  ChatSessionResponse,
  ChatUsageResponse,
  SendChatMessageResponse,
} from './types/chat.types';

const DEFAULT_QUOTA_PER_DAY = 50;
const PROVIDER_TIMEOUT_MS = 30_000;
const REQUEST_LEASE_MS = PROVIDER_TIMEOUT_MS + 30_000;
const DEFAULT_SESSION_PAGE = 20;
const DEFAULT_MESSAGE_PAGE = 50;
const MAX_PAGE = 100;
const HISTORY_LIMIT = 20;

type ChatSessionRow = {
  id: string;
  languageId: number;
  scenario: string | null;
  title: string | null;
  model: string | null;
  promptVersion: string | null;
  messageCount: number;
  lastMessageAt: Date | null;
  createdAt: Date;
  archivedAt: Date | null;
};

type ChatMessageRow = {
  id: bigint;
  sessionId: string;
  role: string;
  content: string;
  refSenseId: bigint | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: Prisma.Decimal | null;
  model: string | null;
  createdAt: Date;
};

/**
 * AI Chatbot (M10): phiên chat + tin nhắn + quota ngày.
 * Ghi app.chat_session/chat_message/ai_usage; đọc nghĩa từ điển khi client gửi ref_sense_id.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly languages: LanguageRepository,
    private readonly dictionary: DictionaryService,
    private readonly usage: AiUsageService,
    @Inject(AI_CHAT_PROVIDER) private readonly provider: AiChatProvider,
  ) {}

  async createSession(
    userId: bigint,
    input: {
      language_id: number;
      scenario?: ChatScenario;
      title?: string;
      profile_id?: string;
    },
  ): Promise<ChatSessionResponse> {
    const known = await this.languages.findExistingIds([input.language_id]);
    if (!known.has(input.language_id)) {
      throw new DomainException(
        'LANGUAGE_NOT_FOUND',
        `Ngôn ngữ không tồn tại: ${input.language_id}`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const profileId = await this.resolveProfileId(userId, input.profile_id);

    const created = await this.prisma.chatSession.create({
      data: {
        id: uuidv7(),
        userId,
        profileId,
        languageId: input.language_id,
        scenario: input.scenario ?? 'general',
        title: input.title?.trim() ? input.title.trim() : null,
        model: aiChatModel(this.config),
        promptVersion: CHAT_PROMPT_VERSION,
      },
    });
    return toSessionResponse(created);
  }

  async listSessions(
    userId: bigint,
    query: { limit?: number; cursor?: string },
  ): Promise<{ data: ChatSessionResponse[]; next_cursor: string | null }> {
    const limit = clampLimit(query.limit, DEFAULT_SESSION_PAGE);
    const cursor =
      query.cursor === undefined || query.cursor === ''
        ? null
        : decodeChatSessionCursor(query.cursor);

    const rows = await this.prisma.chatSession.findMany({
      where: {
        userId,
        archivedAt: null,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasNext = rows.length > limit;
    const page = hasNext ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    return {
      data: page.map(toSessionResponse),
      next_cursor:
        hasNext && last
          ? encodeChatSessionCursor({ createdAt: last.createdAt, id: last.id })
          : null,
    };
  }

  async getSession(
    userId: bigint,
    sessionId: string,
  ): Promise<ChatSessionResponse> {
    const session = await this.getSessionOr404(userId, sessionId);
    return toSessionResponse(session);
  }

  async updateSession(
    userId: bigint,
    sessionId: string,
    input: { title?: string; scenario?: ChatScenario },
  ): Promise<ChatSessionResponse> {
    const session = await this.getSessionOr404(userId, sessionId);
    if (session.archivedAt) {
      throw archivedSession();
    }
    if (input.title === undefined && input.scenario === undefined) {
      return toSessionResponse(session);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.chatSession.updateMany({
        where: { id: session.id, userId, archivedAt: null },
        data: {
          ...(input.title === undefined ? {} : { title: input.title.trim() }),
          ...(input.scenario === undefined ? {} : { scenario: input.scenario }),
        },
      });
      const current = await this.getSessionOr404(userId, session.id, tx);
      if (result.count === 0) {
        throw archivedSession();
      }
      return current;
    });
    return toSessionResponse(updated);
  }

  async archiveSession(
    userId: bigint,
    sessionId: string,
  ): Promise<ChatSessionResponse> {
    const session = await this.getSessionOr404(userId, sessionId);
    if (session.archivedAt) {
      return toSessionResponse(session);
    }
    const archived = await this.prisma.$transaction(async (tx) => {
      await tx.chatSession.updateMany({
        where: { id: session.id, userId, archivedAt: null },
        data: {
          archivedAt: new Date(),
          pendingRequestId: null,
          pendingRequestExpiresAt: null,
        },
      });
      return this.getSessionOr404(userId, session.id, tx);
    });
    return toSessionResponse(archived);
  }

  async listMessages(
    userId: bigint,
    sessionId: string,
    query: { limit?: number; cursor?: string },
  ): Promise<{ data: ChatMessageResponse[]; next_cursor: string | null }> {
    const session = await this.getSessionOr404(userId, sessionId);
    const limit = clampLimit(query.limit, DEFAULT_MESSAGE_PAGE);
    const cursor =
      query.cursor === undefined || query.cursor === ''
        ? null
        : decodeChatMessageCursor(query.cursor);

    const rows = await this.prisma.chatMessage.findMany({
      where: {
        sessionId: session.id,
        ...(cursor
          ? {
              OR: [
                { createdAt: { gt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });

    const hasNext = rows.length > limit;
    const page = hasNext ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    return {
      data: page.map(toMessageResponse),
      next_cursor:
        hasNext && last
          ? encodeChatMessageCursor({
              createdAt: last.createdAt,
              id: last.id,
            })
          : null,
    };
  }

  async sendMessage(
    userId: bigint,
    sessionId: string,
    dto: SendChatMessageDto,
  ): Promise<SendChatMessageResponse> {
    const session = await this.getSessionOr404(userId, sessionId);
    if (session.archivedAt) {
      throw archivedSession();
    }

    // Claim before reading history/reserving quota. The DB lease coordinates
    // all API processes without holding a transaction open during the AI call.
    const requestId = uuidv7();
    const now = new Date();
    const claimed = await this.prisma.chatSession.updateMany({
      where: {
        id: session.id,
        userId,
        archivedAt: null,
        OR: [
          { pendingRequestId: null },
          { pendingRequestExpiresAt: { lte: now } },
        ],
      },
      data: {
        pendingRequestId: requestId,
        pendingRequestExpiresAt: new Date(now.getTime() + REQUEST_LEASE_MS),
      },
    });
    if (claimed.count === 0) {
      const current = await this.getSessionOr404(userId, sessionId);
      if (current.archivedAt) {
        throw archivedSession();
      }
      throw new DomainException(
        'CHAT_SESSION_BUSY',
        'Trợ lý đang trả lời trong phiên này, vui lòng chờ rồi gửi tiếp',
        HttpStatus.CONFLICT,
      );
    }

    try {
      return await this.sendMessageWithLease(userId, session, dto, requestId);
    } finally {
      // A stale request must never release a newer request's lease.
      await this.prisma.chatSession
        .updateMany({
          where: { id: session.id, userId, pendingRequestId: requestId },
          data: { pendingRequestId: null, pendingRequestExpiresAt: null },
        })
        .catch((error: unknown) => {
          this.logger.error(
            `Không giải phóng được lượt chat: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown'}`,
          );
        });
    }
  }

  private async sendMessageWithLease(
    userId: bigint,
    session: ChatSessionRow,
    dto: SendChatMessageDto,
    requestId: string,
  ): Promise<SendChatMessageResponse> {
    const content = dto.content.trim();
    if (content.length === 0) {
      throw new DomainException(
        'VALIDATION_FAILED',
        'Nội dung tin nhắn không được để trống',
        HttpStatus.BAD_REQUEST,
      );
    }

    const senseContext =
      dto.ref_sense_id === undefined
        ? null
        : await this.buildSenseContext(dto.ref_sense_id);

    const timezone = await this.resolveTimezone(userId);
    const period = periodDate(localDateString(new Date(), timezone));
    const limit = this.quotaLimit();
    const requestCount = await this.usage.reserveDailyRequest(
      this.prisma,
      userId,
      period,
      'chat',
      limit,
    );

    const languageCode =
      (await this.languages.findCodeById(session.languageId)) ?? 'en';
    const history = await this.loadHistory(session.id);
    const messages = buildChatMessages({
      scenario: (session.scenario ?? 'general') as ChatScenario,
      targetLanguage: languageCode,
      history: [...history, { role: 'user', content }],
      senseContext,
    });

    // The response model is metadata, not necessarily a valid gateway alias.
    // Use current deployment config so existing demo sessions work after a switch.
    const model = aiChatModel(this.config);
    let reply;
    try {
      reply = await this.provider.chat({
        messages,
        model,
        timeoutMs: PROVIDER_TIMEOUT_MS,
        senseContext,
      });
    } catch (error) {
      this.logger.warn(
        `AI provider lỗi: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown'}`,
      );
      throw new DomainException(
        'AI_PROVIDER_UNAVAILABLE',
        'Trợ lý AI đang bận, vui lòng thử lại sau',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const now = new Date();
    const [userMessage, assistantMessage] = await this.prisma.$transaction(
      async (tx) => {
        // This conditional update locks the session row until commit. Archive
        // invalidates the token, and an expired/replaced lease cannot write late.
        const committed = await tx.chatSession.updateMany({
          where: {
            id: session.id,
            userId,
            archivedAt: null,
            pendingRequestId: requestId,
            pendingRequestExpiresAt: { gt: new Date() },
          },
          data: {
            messageCount: { increment: 2 },
            lastMessageAt: now,
            model,
            promptVersion: CHAT_PROMPT_VERSION,
            pendingRequestId: null,
            pendingRequestExpiresAt: null,
          },
        });
        if (committed.count === 0) {
          const current = await this.getSessionOr404(userId, session.id, tx);
          if (current.archivedAt) {
            throw archivedSession();
          }
          throw new DomainException(
            'CHAT_REQUEST_EXPIRED',
            'Lượt chat đã hết thời hạn xử lý, vui lòng gửi lại',
            HttpStatus.CONFLICT,
          );
        }
        const createdUser = await tx.chatMessage.create({
          data: {
            sessionId: session.id,
            role: 'user',
            content,
            contentJson: {},
            refSenseId: senseContext ? BigInt(senseContext.senseId) : null,
          },
        });
        const createdAssistant = await tx.chatMessage.create({
          data: {
            sessionId: session.id,
            role: 'assistant',
            content: reply.content,
            contentJson: {},
            tokensIn: reply.tokensIn,
            tokensOut: reply.tokensOut,
            costUsd: reply.costUsd,
            model: reply.model,
          },
        });
        await this.usage.addUsage(
          tx,
          userId,
          period,
          'chat',
          reply.tokensIn,
          reply.tokensOut,
          reply.costUsd,
        );
        return [createdUser, createdAssistant];
      },
    );

    return {
      user_message: toMessageResponse(userMessage),
      assistant_message: toMessageResponse(assistantMessage),
      usage: { request_count: requestCount, limit },
    };
  }

  async getUsage(userId: bigint): Promise<ChatUsageResponse> {
    const timezone = await this.resolveTimezone(userId);
    const day = localDateString(new Date(), timezone);
    const requestCount = await this.usage.getDailyRequestCount(
      this.prisma,
      userId,
      periodDate(day),
      'chat',
    );
    return {
      feature: 'chat',
      period: day,
      request_count: requestCount,
      limit: this.quotaLimit(),
    };
  }

  private async getSessionOr404(
    userId: bigint,
    sessionId: string,
    client: AiDbClient = this.prisma,
  ): Promise<ChatSessionRow> {
    const session = await client.chatSession.findFirst({
      where: { id: sessionId, userId },
    });
    if (!session) {
      throw new DomainException(
        'CHAT_SESSION_NOT_FOUND',
        'Không tìm thấy phiên chat',
        HttpStatus.NOT_FOUND,
      );
    }
    return session;
  }

  private async loadHistory(
    sessionId: string,
  ): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
    const rows = await this.prisma.chatMessage.findMany({
      where: { sessionId, role: { in: ['user', 'assistant'] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: HISTORY_LIMIT,
      select: { role: true, content: true },
    });
    return rows.reverse().map((row) => ({
      role: row.role as 'user' | 'assistant',
      content: row.content,
    }));
  }

  private async buildSenseContext(rawSenseId: string): Promise<AiSenseContext> {
    const senseId = parsePositivePostgresBigInt(rawSenseId, 'sense_id');
    const detail = await this.dictionary.getSenseDetail(senseId);
    const firstExample = detail.examples.at(0) ?? null;
    return {
      senseId: detail.card.sense_id,
      lemma: detail.card.lemma,
      reading: detail.card.reading,
      pos: detail.card.pos,
      glossVi: detail.card.gloss_vi,
      glossEn: detail.card.gloss_en,
      glossViMachine: detail.card.gloss_vi_machine === true,
      example: firstExample
        ? {
            text: firstExample.text,
            translationVi: firstExample.translation['vi'] ?? null,
          }
        : null,
    };
  }

  private async resolveTimezone(userId: bigint): Promise<string> {
    const settings = await this.prisma.userSettings.findUnique({
      where: { userId },
      select: { timezone: true },
    });
    return settings?.timezone ?? DEFAULT_TIMEZONE;
  }

  private quotaLimit(): number {
    const raw = this.config.get<number | string>('AI_DAILY_REQUEST_LIMIT');
    const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw;
    if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_QUOTA_PER_DAY;
    }
    return parsed;
  }

  private async resolveProfileId(
    userId: bigint,
    profileId?: string,
  ): Promise<string | null> {
    if (profileId !== undefined) {
      const owned = await this.prisma.studyProfile.findFirst({
        where: { id: profileId, userId },
        select: { id: true },
      });
      if (!owned) {
        throw new DomainException(
          'PROFILE_NOT_FOUND',
          'Không tìm thấy hồ sơ học',
          HttpStatus.NOT_FOUND,
        );
      }
      return profileId;
    }

    const settings = await this.prisma.userSettings.findUnique({
      where: { userId },
    });
    if (settings?.activeProfileId) {
      return settings.activeProfileId;
    }
    const fallback = await this.prisma.studyProfile.findFirst({
      where: { userId, isDefault: true },
      select: { id: true },
    });
    // Chat không bắt buộc hồ sơ học (cột profile_id nullable) — user mới vẫn chat được.
    return fallback?.id ?? null;
  }
}

function clampLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  return Math.min(Math.max(value, 1), MAX_PAGE);
}

function periodDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function archivedSession(): DomainException {
  return new DomainException(
    'CHAT_SESSION_ARCHIVED',
    'Phiên chat đã được lưu trữ, không thể thay đổi',
    HttpStatus.CONFLICT,
  );
}

function toSessionResponse(row: ChatSessionRow): ChatSessionResponse {
  return {
    id: row.id,
    language_id: row.languageId,
    scenario: row.scenario,
    title: row.title,
    model: row.model,
    prompt_version: row.promptVersion,
    message_count: row.messageCount,
    last_message_at: row.lastMessageAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
    archived_at: row.archivedAt?.toISOString() ?? null,
  };
}

function toMessageResponse(row: ChatMessageRow): ChatMessageResponse {
  return {
    id: row.id.toString(),
    session_id: row.sessionId,
    role: row.role,
    content: row.content,
    ref_sense_id: row.refSenseId?.toString() ?? null,
    tokens_in: row.tokensIn,
    tokens_out: row.tokensOut,
    cost_usd: row.costUsd === null ? null : row.costUsd.toString(),
    model: row.model,
    created_at: row.createdAt.toISOString(),
  };
}

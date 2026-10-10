import { validateChatImages } from './chat-images';
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
  AiChatMessage,
  AiChatProvider,
  AiChatRequest,
  AiChatResult,
  AiProviderError,
  AiSenseContext,
  isAbortError,
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
const DEFAULT_PROVIDER_TIMEOUT_MS = 60_000;
const REQUEST_LEASE_GRACE_MS = 30_000;
const PROVIDER_RETRY_DELAY_MS = 700;
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

/** Sự kiện SSE cho endpoint streaming (`POST .../messages/stream`). */
export type ChatStreamEvent =
  | { type: 'start'; model: string }
  | { type: 'delta'; content: string }
  | { type: 'done'; response: SendChatMessageResponse }
  | { type: 'error'; code: string; message: string };

/** Kết quả chuẩn bị một lượt chat (quota đã reserve, messages đã dựng). */
interface PreparedTurn {
  content: string;
  senseContext: AiSenseContext | null;
  period: Date;
  limit: number;
  requestCount: number;
  messages: AiChatMessage[];
  model: string;
}

/**
 * AI Chatbot (M10/M10.1): phiên chat + tin nhắn + quota ngày + streaming SSE.
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
    const { session, requestId } = await this.claimSession(userId, sessionId);
    try {
      return await this.sendMessageWithLease(userId, session, dto, requestId);
    } finally {
      await this.releaseLease(userId, session.id, requestId);
    }
  }

  /**
   * Trả lời dần qua SSE (M10.1). Sự kiện: start → delta* → done/error.
   * Lỗi sớm (busy/archived/quota/provider fail trước delta đầu) được throw ra
   * để controller trả JSON status như endpoint thường.
   */
  async sendMessageStream(
    userId: bigint,
    sessionId: string,
    dto: SendChatMessageDto,
    emit: (event: ChatStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const { session, requestId } = await this.claimSession(userId, sessionId);
    try {
      await this.streamMessageWithLease(
        userId,
        session,
        dto,
        requestId,
        emit,
        signal,
      );
    } finally {
      await this.releaseLease(userId, session.id, requestId);
    }
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

  // ---------------------------------------------------------------- internals

  /**
   * Giành "lease" cho phiên trước khi gọi provider — khoá mềm trong DB để nhiều
   * process API không trả lời chồng lên nhau mà không giữ transaction khi gọi AI.
   */
  private async claimSession(
    userId: bigint,
    sessionId: string,
  ): Promise<{ session: ChatSessionRow; requestId: string }> {
    const session = await this.getSessionOr404(userId, sessionId);
    if (session.archivedAt) {
      throw archivedSession();
    }

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
        pendingRequestExpiresAt: new Date(now.getTime() + this.leaseMs()),
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
    return { session, requestId };
  }

  /** A stale request must never release a newer request's lease. */
  private async releaseLease(
    userId: bigint,
    sessionId: string,
    requestId: string,
  ): Promise<void> {
    await this.prisma.chatSession
      .updateMany({
        where: { id: sessionId, userId, pendingRequestId: requestId },
        data: { pendingRequestId: null, pendingRequestExpiresAt: null },
      })
      .catch((error: unknown) => {
        this.logger.error(
          `Không giải phóng được lượt chat: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown'}`,
        );
      });
  }

  private async sendMessageWithLease(
    userId: bigint,
    session: ChatSessionRow,
    dto: SendChatMessageDto,
    requestId: string,
  ): Promise<SendChatMessageResponse> {
    const { content, senseContext, images } = await this.normalizeInput(dto);
    const prepared = await this.prepareTurn(
      userId,
      session,
      content,
      senseContext,
      images,
    );

    let reply: AiChatResult;
    try {
      reply = await this.callProviderWithRetry(() =>
        this.provider.chat(this.buildProviderRequest(prepared)),
      );
    } catch (error) {
      throw this.providerUnavailable(error);
    }

    return this.persistTurn(userId, session, requestId, prepared, reply);
  }

  private async streamMessageWithLease(
    userId: bigint,
    session: ChatSessionRow,
    dto: SendChatMessageDto,
    requestId: string,
    emit: (event: ChatStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const { content, senseContext, images } = await this.normalizeInput(dto);
    const prepared = await this.prepareTurn(
      userId,
      session,
      content,
      senseContext,
      images,
    );
    emit({ type: 'start', model: prepared.model });

    const request = this.buildProviderRequest(prepared, signal);
    const stream = this.provider.chatStream?.bind(this.provider);
    let firstDelta = false;
    let reply: AiChatResult;
    try {
      if (stream) {
        reply = await this.callProviderWithRetry(
          () =>
            stream(request, (delta) => {
              firstDelta = true;
              emit({ type: 'delta', content: delta });
            }),
          { signal, shouldRetry: () => !firstDelta },
        );
      } else {
        // Provider không hỗ trợ stream: trả một lần rồi kết thúc như bình thường.
        reply = await this.callProviderWithRetry(
          () => this.provider.chat(request),
          { signal },
        );
        firstDelta = true;
        emit({ type: 'delta', content: reply.content });
      }
    } catch (error) {
      if (!firstDelta) {
        throw this.providerUnavailable(error);
      }
      this.logger.warn(
        `AI stream lỗi giữa chừng: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown'}`,
      );
      emit({
        type: 'error',
        code: 'AI_PROVIDER_UNAVAILABLE',
        message: 'Trợ lý AI đang bận, vui lòng thử lại sau',
      });
      return;
    }

    try {
      const response = await this.persistTurn(
        userId,
        session,
        requestId,
        prepared,
        reply,
      );
      emit({ type: 'done', response });
    } catch (error) {
      if (error instanceof DomainException) {
        const payload = error.getResponse() as {
          code?: string;
          message?: string;
        };
        emit({
          type: 'error',
          code: payload.code ?? 'CHAT_STREAM_FAILED',
          message: payload.message ?? 'Không lưu được tin nhắn',
        });
        return;
      }
      throw error;
    }
  }

  private async normalizeInput(dto: SendChatMessageDto): Promise<{
    content: string;
    senseContext: AiSenseContext | null;
    images?: string[];
  }> {
    const images = validateChatImages(dto.images);
    if (images?.length && this.provider.name !== 'openai') {
      throw new DomainException(
        'CHAT_IMAGES_UNAVAILABLE',
        'Provider hiện tại chưa hỗ trợ ảnh',
        HttpStatus.BAD_REQUEST,
      );
    }
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
    return { content, senseContext, images };
  }

  /** Reserve quota + dựng messages trước khi gọi provider (dùng chung 2 endpoint). */
  private async prepareTurn(
    userId: bigint,
    session: ChatSessionRow,
    content: string,
    senseContext: AiSenseContext | null,
    images?: string[],
  ): Promise<PreparedTurn> {
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

    if (images?.length) {
      // Only the current user turn receives images; persisted history stays text.
      messages[messages.length - 1].images = images;
    }

    // The response model is metadata, not necessarily a valid gateway alias.
    // Use current deployment config so existing demo sessions work after a switch.
    const model = aiChatModel(this.config);
    return {
      content,
      senseContext,
      period,
      limit,
      requestCount,
      messages,
      model,
    };
  }

  /** Lưu user + assistant + usage trong cùng transaction (có kiểm tra lease). */
  private async persistTurn(
    userId: bigint,
    session: ChatSessionRow,
    requestId: string,
    prepared: PreparedTurn,
    reply: AiChatResult,
  ): Promise<SendChatMessageResponse> {
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
            model: prepared.model,
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
            content: prepared.content,
            contentJson: {},
            refSenseId: prepared.senseContext
              ? BigInt(prepared.senseContext.senseId)
              : null,
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
          prepared.period,
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
      usage: {
        request_count: prepared.requestCount,
        limit: prepared.limit,
      },
    };
  }

  private buildProviderRequest(
    prepared: PreparedTurn,
    signal?: AbortSignal,
  ): AiChatRequest {
    return {
      messages: prepared.messages,
      model: prepared.model,
      timeoutMs: this.providerTimeoutMs(),
      senseContext: prepared.senseContext,
      maxTokens: this.providerMaxTokens(),
      reasoningEffort: this.providerReasoningEffort(),
      signal,
    };
  }

  /** Thử lại 1 lần với lỗi tạm thời (429/5xx/timeout) khi chưa phát delta. */
  private async callProviderWithRetry<T>(
    fn: () => Promise<T>,
    options: { signal?: AbortSignal; shouldRetry?: () => boolean } = {},
  ): Promise<T> {
    const maxAttempts = 2;
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        const clientAborted = options.signal?.aborted === true;
        const retryable =
          !clientAborted &&
          (error instanceof AiProviderError
            ? error.retryable
            : isAbortError(error));
        const allowed = options.shouldRetry ? options.shouldRetry() : true;
        if (!retryable || !allowed || attempt >= maxAttempts) {
          throw error;
        }
        this.logger.warn(
          `AI provider lỗi tạm thời (lần ${attempt}), thử lại sau ${PROVIDER_RETRY_DELAY_MS}ms: ${
            error instanceof Error ? error.message.slice(0, 150) : 'unknown'
          }`,
        );
        await delay(PROVIDER_RETRY_DELAY_MS);
      }
    }
  }

  private providerUnavailable(error: unknown): DomainException {
    this.logger.warn(
      `AI provider lỗi: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown'}`,
    );
    return new DomainException(
      'AI_PROVIDER_UNAVAILABLE',
      'Trợ lý AI đang bận, vui lòng thử lại sau',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  private providerTimeoutMs(): number {
    return (
      this.positiveConfig('AI_CHAT_TIMEOUT_MS') ?? DEFAULT_PROVIDER_TIMEOUT_MS
    );
  }

  private providerMaxTokens(): number | undefined {
    return this.positiveConfig('AI_CHAT_MAX_TOKENS');
  }

  private providerReasoningEffort(): string | undefined {
    return (
      this.config.get<string>('AI_CHAT_REASONING_EFFORT')?.trim() || undefined
    );
  }

  private positiveConfig(key: string): number | undefined {
    const raw = this.config.get<number | string>(key);
    const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw;
    return typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0
      ? parsed
      : undefined;
  }

  private leaseMs(): number {
    return this.providerTimeoutMs() + REQUEST_LEASE_GRACE_MS;
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

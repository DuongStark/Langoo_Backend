import { PrivacyService } from '../../privacy/privacy.service';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { setTimeout as nativeDelay } from 'node:timers/promises';
import { DomainException } from '../../common/errors/domain.exception';
import { LanguageRepository } from '../../db/repositories/language.repository';
import { PrismaService } from '../../db/prisma.service';
import { DictionaryService } from '../../dictionary/dictionary.service';
import {
  AiChatDeltaHandler,
  AiChatProvider,
  AiChatRequest,
  AiProviderError,
} from '../providers/ai-chat.provider';
import { AiUsageService } from '../usage/ai-usage.service';
import { ChatService } from './chat.service';

const SESSION_ID = '01900000-0000-7000-8000-000000000001';

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    userId: 1n,
    profileId: 'profile-1',
    languageId: 2,
    scenario: 'general',
    title: null,
    model: 'stub-v1',
    promptVersion: 'm10-v3',
    summary: null,
    messageCount: 2,
    lastMessageAt: new Date('2026-09-29T10:00:00.000Z'),
    createdAt: new Date('2026-09-29T09:00:00.000Z'),
    archivedAt: null,
    ...overrides,
  };
}

function messageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1n,
    sessionId: SESSION_ID,
    role: 'user',
    content: 'xin chào',
    contentJson: {},
    refSenseId: null,
    tokensIn: null,
    tokensOut: null,
    costUsd: null,
    model: null,
    createdAt: new Date('2026-09-29T10:00:00.000Z'),
    ...overrides,
  };
}

function firstArg<T>(mock: jest.Mock): T {
  const calls = mock.mock.calls as unknown[][];
  const call = calls[0];
  if (!call) {
    throw new Error('expected mock call');
  }
  return call[0] as T;
}

function createSetup(configValues: Record<string, string | number> = {}) {
  const tx = {
    chatMessage: { create: jest.fn() },
    chatSession: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn().mockResolvedValue(sessionRow()),
    },
  };
  const prisma = {
    chatSession: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    chatMessage: { findMany: jest.fn() },
    userSettings: { findUnique: jest.fn() },
    studyProfile: { findFirst: jest.fn() },
    $transaction: jest.fn((fn: (client: unknown) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  const config = {
    get: jest.fn((key: string) => configValues[key]),
  } as unknown as ConfigService;
  const languages = {
    findExistingIds: jest.fn(),
    findCodeById: jest.fn(),
  };
  const dictionary = { getSenseDetail: jest.fn() };
  const usage = {
    reserveDailyRequest: jest.fn(),
    addUsage: jest.fn(),
    getDailyRequestCount: jest.fn(),
  };
  const providerChat = jest.fn();
  const provider: AiChatProvider = {
    name: configValues.AI_PROVIDER === 'openai' ? 'openai' : 'stub',
    chat: providerChat,
  };

  const service = new ChatService(
    prisma as unknown as PrismaService,
    config,
    languages as unknown as LanguageRepository,
    dictionary as unknown as DictionaryService,
    usage as unknown as AiUsageService,
    provider,
    {
      assertAiAllowed: jest.fn().mockResolvedValue(undefined),
    } as unknown as PrivacyService,
  );
  return {
    service,
    prisma,
    tx,
    languages,
    dictionary,
    usage,
    providerChat,
    provider,
  };
}

describe('M10.1 service regressions', () => {
  function setup() {
    const state = createSetup({ AI_CHAT_TIMEOUT_MS: 60_000 });
    state.prisma.chatSession.findFirst.mockResolvedValue(sessionRow());
    state.prisma.chatMessage.findMany.mockResolvedValue([]);
    state.usage.reserveDailyRequest.mockResolvedValue(1);
    state.tx.chatMessage.create.mockImplementation(
      (args: { data: Record<string, unknown> }) =>
        Promise.resolve(messageRow(args.data)),
    );
    const reply = {
      content: 'answer',
      model: 'stub-v1',
      tokensIn: 2,
      tokensOut: 2,
      costUsd: 0,
    };
    const stream = jest.fn(
      (_request: AiChatRequest, delta: AiChatDeltaHandler) => {
        delta('answer');
        return Promise.resolve(reply);
      },
    );
    state.provider.chatStream = stream;
    return { ...state, stream, reply };
  }

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('provider failure before delta emits nothing, allowing a JSON 503', async () => {
    const s = setup();
    s.stream.mockRejectedValue(new Error('provider failed'));
    const emit = jest.fn();
    await expect(
      s.service.sendMessageStream(1n, SESSION_ID, { content: 'hi' }, emit),
    ).rejects.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE' });
    expect(emit).not.toHaveBeenCalled();
    expect(s.tx.chatMessage.create).not.toHaveBeenCalled();
  });

  it('fallback provider without chatStream emits the normal payload once', async () => {
    const s = setup();
    delete s.provider.chatStream;
    s.providerChat.mockResolvedValue(s.reply);
    const emit = jest.fn();
    await s.service.sendMessageStream(1n, SESSION_ID, { content: 'hi' }, emit);
    expect(s.providerChat).toHaveBeenCalledTimes(1);
    expect(
      emit.mock.calls.map((call: [{ type: string }]) => call[0].type),
    ).toEqual(['start', 'delta', 'done']);
    expect(s.tx.chatMessage.create).toHaveBeenCalledTimes(2);
  });

  it('fallback returning whitespace fails before headers and persistence', async () => {
    const s = setup();
    delete s.provider.chatStream;
    s.providerChat.mockResolvedValue({ ...s.reply, content: '  ' });
    const emit = jest.fn();
    await expect(
      s.service.sendMessageStream(1n, SESSION_ID, { content: 'hi' }, emit),
    ).rejects.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE' });
    expect(emit).not.toHaveBeenCalled();
    expect(s.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('empty deltas do not begin a stream or prevent retry', async () => {
    jest.useFakeTimers();
    const s = setup();
    s.stream.mockImplementationOnce((_request, delta) => {
      delta('');
      return Promise.reject(new AiProviderError('busy', 429));
    });
    const emit = jest.fn();
    const pending = s.service.sendMessageStream(
      1n,
      SESSION_ID,
      { content: 'hi' },
      emit,
    );
    await jest.advanceTimersByTimeAsync(700);
    await pending;
    expect(s.stream).toHaveBeenCalledTimes(2);
    expect(
      emit.mock.calls.map((call: [{ type: string }]) => call[0].type),
    ).toEqual(['start', 'delta', 'done']);
  });

  it('abort during retry delay prevents another provider call and releases the lease', async () => {
    jest.useFakeTimers();
    const s = setup();
    s.stream.mockRejectedValueOnce(new AiProviderError('busy', 429));
    const abort = new AbortController();
    const pending = s.service.sendMessageStream(
      1n,
      SESSION_ID,
      { content: 'hi' },
      jest.fn(),
      abort.signal,
    );
    const assertion = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
    });
    await jest.advanceTimersByTimeAsync(1);
    abort.abort();
    await jest.advanceTimersByTimeAsync(700);
    await assertion;
    expect(s.stream).toHaveBeenCalledTimes(1);
    expect(s.tx.chatMessage.create).not.toHaveBeenCalled();
    expect(s.prisma.chatSession.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: { pendingRequestId: null, pendingRequestExpiresAt: null },
      }),
    );
  });

  it('does not save after an adapter resolves despite client abort', async () => {
    const s = setup();
    const abort = new AbortController();
    s.stream.mockImplementationOnce((_request, delta) => {
      delta('answer');
      abort.abort();
      return Promise.resolve(s.reply);
    });
    const emit = jest.fn();
    await expect(
      s.service.sendMessageStream(
        1n,
        SESSION_ID,
        { content: 'hi' },
        emit,
        abort.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(s.prisma.$transaction).not.toHaveBeenCalled();
    expect(
      emit.mock.calls.some(
        (call: [{ type: string }]) => call[0].type === 'done',
      ),
    ).toBe(false);
  });

  it('DB failure after delta produces one sanitized error event', async () => {
    const s = setup();
    s.prisma.$transaction.mockRejectedValue(new Error('private SQL prompt'));
    const emit = jest.fn();
    await s.service.sendMessageStream(1n, SESSION_ID, { content: 'hi' }, emit);
    expect(
      emit.mock.calls.map((call: [{ type: string }]) => call[0].type),
    ).toEqual(['start', 'delta', 'error']);
    expect(emit).toHaveBeenLastCalledWith({
      type: 'error',
      code: 'CHAT_STREAM_FAILED',
      message: 'Không lưu được tin nhắn, vui lòng thử lại sau',
    });
  });

  it('provider failure after delta is not retried and does not leak its message to logs', async () => {
    const s = setup();
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    s.stream.mockImplementationOnce((_request, delta) => {
      delta('answer');
      return Promise.reject(
        new AiProviderError('private-prompt test-only-key', 503),
      );
    });
    const emit = jest.fn();
    await s.service.sendMessageStream(1n, SESSION_ID, { content: 'hi' }, emit);
    expect(s.stream).toHaveBeenCalledTimes(1);
    expect(s.prisma.$transaction).not.toHaveBeenCalled();
    expect(emit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'error',
        code: 'AI_PROVIDER_UNAVAILABLE',
      }),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(
      /private-prompt|test-only-key/,
    );
  });

  it('lease covers a timeout followed by a successful full-length retry', async () => {
    jest.useFakeTimers();
    const s = setup();
    let expiresAt = new Date(0);
    s.prisma.chatSession.updateMany.mockImplementation(
      (args: { data: { pendingRequestExpiresAt: Date | null } }) => {
        if (args.data.pendingRequestExpiresAt)
          expiresAt = args.data.pendingRequestExpiresAt;
        return Promise.resolve({ count: 1 });
      },
    );
    s.tx.chatSession.updateMany.mockImplementation(() =>
      Promise.resolve({ count: expiresAt > new Date() ? 1 : 0 }),
    );
    s.stream
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            setTimeout(
              () => reject(new DOMException('timeout', 'TimeoutError')),
              60_000,
            );
          }),
      )
      .mockImplementationOnce(
        (_request, delta) =>
          new Promise((resolve) => {
            setTimeout(() => {
              delta('answer');
              resolve(s.reply);
            }, 59_000);
          }),
      );
    const emit = jest.fn();
    const pending = s.service.sendMessageStream(
      1n,
      SESSION_ID,
      { content: 'hi' },
      emit,
    );
    const assertion = expect(pending).resolves.toBeUndefined();
    await jest.advanceTimersByTimeAsync(60_000);
    // The production backoff uses native timers/promises, independently of the
    // fake clock used to simulate the two long generation attempts.
    await nativeDelay(750);
    await jest.advanceTimersByTimeAsync(60_000);
    await assertion;
    expect(s.stream).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'done' }),
    );
  });
});

describe('ChatService', () => {
  describe('createSession', () => {
    it('ngôn ngữ không tồn tại → 400 LANGUAGE_NOT_FOUND', async () => {
      const { service, languages } = createSetup();
      languages.findExistingIds.mockResolvedValue(new Set());

      await expect(
        service.createSession(1n, { language_id: 99 }),
      ).rejects.toMatchObject({ code: 'LANGUAGE_NOT_FOUND' });
    });

    it('tạo phiên với default scenario/model/prompt_version và active profile', async () => {
      const { service, prisma, languages } = createSetup();
      languages.findExistingIds.mockResolvedValue(new Set([2]));
      prisma.userSettings.findUnique.mockResolvedValue({
        activeProfileId: 'profile-active',
      });
      prisma.chatSession.create.mockImplementation(
        (args: { data: Record<string, unknown> }) =>
          Promise.resolve(sessionRow(args.data)),
      );

      const result = await service.createSession(1n, { language_id: 2 });

      const createArgs = firstArg<{ data: Record<string, unknown> }>(
        prisma.chatSession.create,
      );
      expect(createArgs.data).toMatchObject({
        userId: 1n,
        profileId: 'profile-active',
        languageId: 2,
        scenario: 'general',
        model: 'stub-v1',
        promptVersion: 'm10-v3',
      });
      expect(result.scenario).toBe('general');
      expect(result.created_at).toBe('2026-09-29T09:00:00.000Z');
    });

    it('không có hồ sơ học → vẫn tạo phiên với profile_id null', async () => {
      const { service, prisma, languages } = createSetup();
      languages.findExistingIds.mockResolvedValue(new Set([2]));
      prisma.userSettings.findUnique.mockResolvedValue(null);
      prisma.studyProfile.findFirst.mockResolvedValue(null);
      prisma.chatSession.create.mockImplementation(
        (args: { data: Record<string, unknown> }) =>
          Promise.resolve(sessionRow(args.data)),
      );

      await service.createSession(1n, { language_id: 2 });

      const createArgs = firstArg<{ data: { profileId: string | null } }>(
        prisma.chatSession.create,
      );
      expect(createArgs.data.profileId).toBeNull();
    });
  });

  describe('sendMessage', () => {
    it('lưu 2 tin, cập nhật phiên và trả usage trong một transaction', async () => {
      const { service, prisma, tx, languages, usage, providerChat } =
        createSetup();
      prisma.chatSession.findFirst.mockResolvedValue(sessionRow());
      prisma.userSettings.findUnique.mockResolvedValue({
        timezone: 'Asia/Ho_Chi_Minh',
      });
      prisma.chatMessage.findMany.mockResolvedValue([
        { role: 'assistant', content: 'câu cũ' },
      ]);
      languages.findCodeById.mockResolvedValue('ja');
      usage.reserveDailyRequest.mockResolvedValue(3);
      providerChat.mockResolvedValue({
        content: '[stub] xin chào',
        model: 'stub-v1',
        tokensIn: 10,
        tokensOut: 4,
        costUsd: 0,
      });
      tx.chatMessage.create
        .mockResolvedValueOnce(messageRow())
        .mockResolvedValueOnce(
          messageRow({
            id: 2n,
            role: 'assistant',
            content: '[stub] xin chào',
            tokensIn: 10,
            tokensOut: 4,
            costUsd: '0.000000',
            model: 'stub-v1',
          }),
        );

      const result = await service.sendMessage(1n, SESSION_ID, {
        content: '  xin chào  ',
      });

      // quota reserve dùng đúng period và limit mặc định
      const reserveArgs = usage.reserveDailyRequest.mock.calls[0] as [
        unknown,
        bigint,
        Date,
        string,
        number,
      ];
      expect(reserveArgs[1]).toBe(1n);
      expect(reserveArgs[2]).toBeInstanceOf(Date);
      expect(reserveArgs[3]).toBe('chat');
      expect(reserveArgs[4]).toBe(50);

      // provider nhận system + history + tin mới (đã trim)
      const providerArgs = firstArg<AiChatRequest>(providerChat);
      expect(providerArgs.model).toBe('stub-v1');
      expect(providerArgs.messages[0].role).toBe('system');
      expect(providerArgs.messages).toEqual(
        expect.arrayContaining([
          { role: 'assistant', content: 'câu cũ' },
          { role: 'user', content: 'xin chào' },
        ]),
      );

      // transaction: 2 tin + counter + usage cùng period với reserve
      expect(tx.chatMessage.create).toHaveBeenCalledTimes(2);
      const updateArgs = firstArg<{
        data: { messageCount: { increment: number }; lastMessageAt: Date };
      }>(tx.chatSession.updateMany);
      expect(updateArgs.data.messageCount).toEqual({ increment: 2 });
      expect(updateArgs.data.lastMessageAt).toBeInstanceOf(Date);
      expect(usage.addUsage).toHaveBeenCalledTimes(1);
      expect((usage.addUsage.mock.calls[0] as unknown[])[2]).toBe(
        reserveArgs[2],
      );

      expect(result.user_message.content).toBe('xin chào');
      expect(result.assistant_message.role).toBe('assistant');
      expect(result.usage).toEqual({ request_count: 3, limit: 50 });
    });

    it('phiên đã archive → 409, không gọi provider', async () => {
      const { service, prisma, providerChat } = createSetup();
      prisma.chatSession.findFirst.mockResolvedValue(
        sessionRow({ archivedAt: new Date() }),
      );

      await expect(
        service.sendMessage(1n, SESSION_ID, { content: 'hi' }),
      ).rejects.toMatchObject({ code: 'CHAT_SESSION_ARCHIVED' });
      expect(providerChat).not.toHaveBeenCalled();
    });

    it('phiên của user khác → 404 CHAT_SESSION_NOT_FOUND', async () => {
      const { service, prisma } = createSetup();
      prisma.chatSession.findFirst.mockResolvedValue(null);

      await expect(
        service.sendMessage(2n, SESSION_ID, { content: 'hi' }),
      ).rejects.toMatchObject({ code: 'CHAT_SESSION_NOT_FOUND' });
      expect(prisma.chatSession.findFirst).toHaveBeenCalledWith({
        where: { id: SESSION_ID, userId: 2n },
      });
    });

    it('ref_sense_id sai → lỗi từ điển, không tiêu quota', async () => {
      const { service, prisma, dictionary, usage } = createSetup();
      prisma.chatSession.findFirst.mockResolvedValue(sessionRow());
      dictionary.getSenseDetail.mockRejectedValue(
        new DomainException('SENSE_NOT_FOUND', 'Không tìm thấy nghĩa', 404),
      );

      await expect(
        service.sendMessage(1n, SESSION_ID, {
          content: 'hi',
          ref_sense_id: '999999',
        }),
      ).rejects.toMatchObject({ code: 'SENSE_NOT_FOUND' });
      expect(usage.reserveDailyRequest).not.toHaveBeenCalled();
    });

    it('gửi kèm ref_sense_id hợp lệ → provider nhận senseContext', async () => {
      const {
        service,
        prisma,
        tx,
        languages,
        usage,
        providerChat,
        dictionary,
      } = createSetup();
      prisma.chatSession.findFirst.mockResolvedValue(sessionRow());
      prisma.userSettings.findUnique.mockResolvedValue({
        timezone: 'Asia/Ho_Chi_Minh',
      });
      prisma.chatMessage.findMany.mockResolvedValue([]);
      languages.findCodeById.mockResolvedValue('ja');
      usage.reserveDailyRequest.mockResolvedValue(1);
      dictionary.getSenseDetail.mockResolvedValue({
        card: {
          sense_id: '1',
          lemma: '走る',
          reading: 'はしる',
          pos: 'verb',
          gloss_vi: 'chạy',
          gloss_en: 'to run',
          gloss_vi_machine: true,
        },
        examples: [
          {
            text: '毎朝走ります。',
            translation: { vi: 'Tôi chạy mỗi sáng.' },
          },
        ],
      });
      providerChat.mockResolvedValue({
        content: '[stub] 走る: chạy',
        model: 'stub-v1',
        tokensIn: 5,
        tokensOut: 5,
        costUsd: 0,
      });
      tx.chatMessage.create
        .mockResolvedValueOnce(messageRow({ refSenseId: 1n }))
        .mockResolvedValueOnce(messageRow({ id: 2n, role: 'assistant' }));

      const result = await service.sendMessage(1n, SESSION_ID, {
        content: 'nghĩa là gì?',
        ref_sense_id: '1',
      });

      const providerArgs = firstArg<AiChatRequest>(providerChat);
      expect(providerArgs.senseContext).toMatchObject({
        lemma: '走る',
        glossVi: 'chạy',
        glossViMachine: true,
      });
      const userCreate = firstArg<{ data: { refSenseId: bigint | null } }>(
        tx.chatMessage.create,
      );
      expect(userCreate.data.refSenseId).toBe(1n);
      expect(result.user_message.ref_sense_id).toBe('1');
    });

    it('hết quota → 429, không gọi provider/transaction', async () => {
      const { service, prisma, usage, providerChat } = createSetup();
      prisma.chatSession.findFirst.mockResolvedValue(sessionRow());
      prisma.userSettings.findUnique.mockResolvedValue({
        timezone: 'Asia/Ho_Chi_Minh',
      });
      usage.reserveDailyRequest.mockRejectedValue(
        new DomainException('AI_QUOTA_EXCEEDED', 'hết lượt', 429, {
          limit: 50,
        }),
      );

      await expect(
        service.sendMessage(1n, SESSION_ID, { content: 'hi' }),
      ).rejects.toMatchObject({ code: 'AI_QUOTA_EXCEEDED' });
      expect(providerChat).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('provider lỗi → 503, không lưu tin', async () => {
      const { service, prisma, usage, providerChat } = createSetup();
      prisma.chatSession.findFirst.mockResolvedValue(sessionRow());
      prisma.userSettings.findUnique.mockResolvedValue({
        timezone: 'Asia/Ho_Chi_Minh',
      });
      prisma.chatMessage.findMany.mockResolvedValue([]);
      usage.reserveDailyRequest.mockResolvedValue(1);
      providerChat.mockRejectedValue(new Error('timeout'));

      await expect(
        service.sendMessage(1n, SESSION_ID, { content: 'hi' }),
      ).rejects.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.chatSession.updateMany).toHaveBeenLastCalledWith({
        where: {
          id: SESSION_ID,
          userId: 1n,
          pendingRequestId: expect.any(String) as unknown,
        },
        data: { pendingRequestId: null, pendingRequestExpiresAt: null },
      });
    });

    it('phiên bận → 409 trước quota/provider', async () => {
      const { service, prisma, usage, providerChat } = createSetup();
      prisma.chatSession.findFirst.mockResolvedValue(sessionRow());
      prisma.chatSession.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(
        service.sendMessage(1n, SESSION_ID, { content: 'hi' }),
      ).rejects.toMatchObject({ code: 'CHAT_SESSION_BUSY' });
      expect(usage.reserveDailyRequest).not.toHaveBeenCalled();
      expect(providerChat).not.toHaveBeenCalled();
    });

    it('model alias lấy từ config, metadata trả về không đổi model của lượt sau', async () => {
      const { service, prisma, tx, providerChat } = createSetup({
        AI_CHAT_MODEL: 'space-bunny-free',
      });
      prisma.chatSession.findFirst.mockResolvedValue(
        sessionRow({ model: 'stub-v1' }),
      );
      prisma.chatMessage.findMany.mockResolvedValue([]);
      providerChat.mockResolvedValue({
        content: 'reply',
        model: 'upstream-model',
        tokensIn: 2,
        tokensOut: 2,
        costUsd: 0,
      });
      tx.chatMessage.create.mockImplementation(
        (args: { data: Record<string, unknown> }) =>
          Promise.resolve(messageRow(args.data)),
      );

      await service.sendMessage(1n, SESSION_ID, { content: 'first' });
      prisma.chatSession.findFirst.mockResolvedValue(
        sessionRow({ model: 'upstream-model' }),
      );
      await service.sendMessage(1n, SESSION_ID, { content: 'second' });

      expect(
        providerChat.mock.calls.map((call: [AiChatRequest]) => call[0].model),
      ).toEqual(['space-bunny-free', 'space-bunny-free']);
      expect(tx.chatSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            model: 'space-bunny-free',
          }) as unknown,
        }),
      );
      expect(tx.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            role: 'assistant',
            model: 'upstream-model',
          }) as unknown,
        }),
      );
    });

    it('lease hết hạn hoặc bị thay thế → không lưu câu trả lời cũ', async () => {
      const { service, prisma, tx, providerChat, usage } = createSetup();
      prisma.chatSession.findFirst.mockResolvedValue(sessionRow());
      prisma.chatMessage.findMany.mockResolvedValue([]);
      providerChat.mockResolvedValue({
        content: 'reply',
        model: 'stub-v1',
        tokensIn: 2,
        tokensOut: 2,
        costUsd: 0,
      });
      tx.chatSession.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.sendMessage(1n, SESSION_ID, { content: 'hi' }),
      ).rejects.toMatchObject({ code: 'CHAT_REQUEST_EXPIRED' });
      expect(tx.chatMessage.create).not.toHaveBeenCalled();
      expect(usage.addUsage).not.toHaveBeenCalled();
    });
  });

  describe('getUsage', () => {
    it('trả quota hôm nay theo timezone user', async () => {
      const { service, prisma, usage } = createSetup();
      prisma.userSettings.findUnique.mockResolvedValue({
        timezone: 'Asia/Ho_Chi_Minh',
      });
      usage.getDailyRequestCount.mockResolvedValue(7);

      const result = await service.getUsage(1n);

      expect(result.feature).toBe('chat');
      expect(result.request_count).toBe(7);
      expect(result.limit).toBe(50);
      expect(result.period).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('AI_DAILY_REQUEST_LIMIT dạng chuỗi vẫn đọc đúng; giá trị rác dùng mặc định', async () => {
      const stringLimit = createSetup({ AI_DAILY_REQUEST_LIMIT: '7' });
      const junkLimit = createSetup({
        AI_DAILY_REQUEST_LIMIT: 'khong-phai-so',
      });

      const withString = await stringLimit.service.getUsage(1n);
      const withJunk = await junkLimit.service.getUsage(1n);

      expect(withString.limit).toBe(7);
      expect(withJunk.limit).toBe(50);
    });
  });
});

describe('M10.3 request-only images', () => {
  const image =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII=';
  it.each([false, true])(
    'forwards image, persists only text, next turn excludes it (stream=%s)',
    async (stream) => {
      const { service, prisma, tx, providerChat } = createSetup({
        AI_PROVIDER: 'openai',
      });
      prisma.chatSession.findFirst.mockResolvedValue(sessionRow());
      prisma.chatMessage.findMany.mockResolvedValue([]);
      providerChat.mockResolvedValue({
        content: 'answer',
        model: 'qwen',
        tokensIn: 10,
        tokensOut: 2,
        costUsd: 0,
      });
      tx.chatMessage.create.mockImplementation(
        (args: { data: Record<string, unknown> }) =>
          Promise.resolve(messageRow(args.data)),
      );
      const dto = { content: 'Đọc chữ trong ảnh', images: [image] };
      if (stream)
        await service.sendMessageStream(1n, SESSION_ID, dto, jest.fn());
      else await service.sendMessage(1n, SESSION_ID, dto);
      const req = firstArg<AiChatRequest>(providerChat);
      expect(req.messages[req.messages.length - 1]).toMatchObject({
        content: dto.content,
        images: [image],
      });
      expect(JSON.stringify(tx.chatMessage.create.mock.calls)).not.toContain(
        image,
      );
      expect(
        firstArg<{ data: { content: string; contentJson: unknown } }>(
          tx.chatMessage.create,
        ).data,
      ).toMatchObject({ content: dto.content, contentJson: {} });
      prisma.chatMessage.findMany.mockResolvedValue([
        { role: 'user', content: dto.content },
      ]);
      await service.sendMessage(1n, SESSION_ID, { content: 'Hỏi tiếp' });
      const next = (providerChat.mock.calls[1] as [AiChatRequest])[0];
      expect(next.messages.every((m) => !m.images)).toBe(true);
    },
  );
  it('rejects image on stub before reserving quota or persisting', async () => {
    const { service, prisma, usage, providerChat } = createSetup();
    prisma.chatSession.findFirst.mockResolvedValue(sessionRow());
    await expect(
      service.sendMessage(1n, SESSION_ID, { content: 'hi', images: [image] }),
    ).rejects.toMatchObject({ code: 'CHAT_IMAGES_UNAVAILABLE' });
    expect(usage.reserveDailyRequest).not.toHaveBeenCalled();
    expect(providerChat).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

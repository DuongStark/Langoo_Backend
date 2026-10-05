import { ConfigService } from '@nestjs/config';
import { DomainException } from '../../common/errors/domain.exception';
import { LanguageRepository } from '../../db/repositories/language.repository';
import { PrismaService } from '../../db/prisma.service';
import { DictionaryService } from '../../dictionary/dictionary.service';
import { AiChatProvider, AiChatRequest } from '../providers/ai-chat.provider';
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
    promptVersion: 'm10-v1',
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
  const provider: AiChatProvider = { name: 'stub', chat: providerChat };

  const service = new ChatService(
    prisma as unknown as PrismaService,
    config,
    languages as unknown as LanguageRepository,
    dictionary as unknown as DictionaryService,
    usage as unknown as AiUsageService,
    provider,
  );
  return { service, prisma, tx, languages, dictionary, usage, providerChat };
}

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
        promptVersion: 'm10-v1',
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

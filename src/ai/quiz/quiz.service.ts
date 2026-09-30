import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v7 as uuidv7 } from 'uuid';
import { DomainException } from '../../common/errors/domain.exception';
import {
  decodeUuidTimeCursor,
  encodeTimeIdCursor,
} from '../../common/pagination/time-cursor';
import { localDateString } from '../../common/time/timezone';
import { PrismaService } from '../../db/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { mathRng } from '../../srs/scheduler/fuzz';
import { SrsService } from '../../srs/srs.service';
import { QuizQuestionType } from '../../sessions/quiz-content';
import { SessionsService } from '../../sessions/sessions.service';
import { SessionDetailResponse } from '../../sessions/types/sessions.types';
import { DEFAULT_TIMEZONE } from '../../users/settings.constants';
import {
  AI_QUIZ_PROVIDER,
  AiQuizProvider,
} from '../providers/ai-quiz.provider';
import { AiUsageService } from '../usage/ai-usage.service';
import { CreateQuizDto, QuizListQueryDto } from './dto/quiz.dto';
import { buildQuizQuestions } from './quiz-generator';
import { QuizSourceRepository } from './repositories/quiz-source.repository';
import {
  CreateQuizResponse,
  QuizDetailResponse,
  QuizListResponse,
  QuizQuestionResponse,
  QuizResponse,
  QuizSessionSummary,
} from './types/quiz.types';

const DEFAULT_QUIZ_DAILY_LIMIT = 15;
const DEFAULT_COOLDOWN_MS = 15_000;
const QUIZ_TTL_DAYS = 7;
const DEFAULT_PAGE = 20;
const MAX_PAGE = 100;
const DETAIL_SESSIONS = 5;
const QUIZ_PROMPT_VERSION = 'm11-v1';

interface QuizRow {
  id: string;
  userId: bigint;
  profileId: string;
  collectionId: string | null;
  quizType: string;
  difficulty: string;
  questionCount: number;
  status: string;
  createdAt: Date;
  expiresAt: Date | null;
}

interface QuizQuestionRow {
  id: bigint;
  ordinal: number;
  questionType: string;
  prompt: string;
  options: unknown;
  correctAnswer: unknown;
  languageId: number | null;
  conceptId: bigint | null;
  itemId: string | null;
}

interface SessionRow {
  id: string;
  quizId: string | null;
  status: string;
  itemCount: number;
  correctCount: number;
  score: number | null;
  startedAt: Date;
  finishedAt: Date | null;
}

/**
 * AI Quiz (M11): sinh quiz từ collection (stub), start phiên kind='quiz',
 * lịch sử; quota riêng + cooldown/dedup chống lạm dụng token.
 */
@Injectable()
export class QuizService {
  private readonly logger = new Logger(QuizService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly srs: SrsService,
    private readonly sessions: SessionsService,
    private readonly sourceRepo: QuizSourceRepository,
    private readonly usage: AiUsageService,
    @Inject(AI_QUIZ_PROVIDER) private readonly quizProvider: AiQuizProvider,
  ) {}

  // ---------------------------------------------------------------- create
  async create(
    userId: bigint,
    dto: CreateQuizDto,
  ): Promise<CreateQuizResponse> {
    const reusable = await this.resolveCooldown(userId, dto);
    if (reusable !== null) {
      return reusable;
    }

    const profile = await this.srs.getProfileContext(userId);
    if (dto.collection_id !== undefined) {
      await this.assertCollectionOwned(userId, profile.id, dto.collection_id);
    }

    const items = await this.sourceRepo.findSourceItems({
      userId,
      profileId: profile.id,
      collectionId: dto.collection_id ?? null,
    });
    const generatorInput = {
      quizType: dto.quiz_type,
      difficulty: dto.difficulty,
      questionCount: dto.question_count,
      languageId: profile.primaryLanguageId,
      items,
      rng: mathRng,
    };
    // Dry-run thuần để KHÔNG tiêu quota khi dữ liệu không đủ (thiếu từ/nhiễu).
    buildQuizQuestions(generatorInput);

    const timezone = await this.resolveTimezone(userId);
    const period = periodDate(localDateString(new Date(), timezone));
    await this.usage.reserveDailyRequest(
      this.prisma,
      userId,
      period,
      'quiz',
      this.quotaLimit(),
    );

    const quizId = uuidv7();
    const expiresAt = new Date(
      Date.now() + QUIZ_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    await this.prisma.quiz.create({
      data: {
        id: quizId,
        userId,
        profileId: profile.id,
        collectionId: dto.collection_id ?? null,
        quizType: dto.quiz_type,
        difficulty: dto.difficulty,
        questionCount: dto.question_count,
        generator: {
          provider: this.quizProvider.name,
          version: QUIZ_PROMPT_VERSION,
        },
        status: 'generating',
        expiresAt,
      },
    });

    let questions;
    try {
      questions = await this.quizProvider.generate(generatorInput);
    } catch (error) {
      await this.prisma.quiz.update({
        where: { id: quizId },
        data: { status: 'failed' },
      });
      this.logger.warn(
        `Sinh quiz lỗi: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown'}`,
      );
      if (error instanceof DomainException) {
        throw error;
      }
      throw new DomainException(
        'AI_PROVIDER_UNAVAILABLE',
        'Dịch vụ tạo câu hỏi đang bận, vui lòng thử lại sau',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const quiz = await this.prisma.$transaction(async (tx) => {
      await tx.quizQuestion.createMany({
        data: questions.map((question, index) => ({
          quizId,
          ordinal: index + 1,
          questionType: question.questionType,
          prompt: question.prompt,
          options: question.options as Prisma.InputJsonValue,
          correctAnswer: question.correctAnswer as Prisma.InputJsonValue,
          explanation: question.explanation,
          languageId: question.languageId,
          conceptId:
            question.conceptId === null ? null : BigInt(question.conceptId),
          itemId: question.itemId,
        })),
      });
      return tx.quiz.update({
        where: { id: quizId },
        data: { status: 'ready', questionCount: questions.length },
      });
    });

    return { ...toQuizResponse(quiz), reused: false };
  }

  // ------------------------------------------------------------------ read
  async list(
    userId: bigint,
    query: QuizListQueryDto,
  ): Promise<QuizListResponse> {
    const limit = clampLimit(query.limit, DEFAULT_PAGE);
    const cursor =
      query.cursor === undefined || query.cursor === ''
        ? null
        : decodeUuidTimeCursor(query.cursor);

    const rows = await this.prisma.quiz.findMany({
      where: {
        userId,
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
    const latestByQuiz = await this.latestSessionsFor(
      userId,
      page.map((row) => row.id),
    );

    const last = page.at(-1);
    return {
      data: page.map((row) => ({
        ...toQuizResponse(row),
        latest_session: toSessionSummary(latestByQuiz.get(row.id) ?? null),
      })),
      next_cursor:
        hasNext && last
          ? encodeTimeIdCursor({ createdAt: last.createdAt, id: last.id })
          : null,
    };
  }

  async get(userId: bigint, quizId: string): Promise<QuizDetailResponse> {
    const quiz = await this.prisma.quiz.findFirst({
      where: { id: quizId, userId },
    });
    if (!quiz) {
      throw quizNotFound();
    }
    const [questions, sessions] = await Promise.all([
      this.prisma.quizQuestion.findMany({
        where: { quizId },
        orderBy: { ordinal: 'asc' },
      }),
      this.prisma.studySession.findMany({
        where: { userId, quizId },
        orderBy: { startedAt: 'desc' },
        take: DETAIL_SESSIONS,
      }),
    ]);

    return {
      quiz: toQuizResponse(quiz),
      questions: questions.map(toQuestionResponse),
      sessions: sessions.map((row) => toSessionSummary(row)!).filter(Boolean),
    };
  }

  // ----------------------------------------------------------------- start
  async start(userId: bigint, quizId: string): Promise<SessionDetailResponse> {
    const quiz = await this.prisma.quiz.findFirst({
      where: { id: quizId, userId },
    });
    if (!quiz) {
      throw quizNotFound();
    }

    const now = new Date();
    if (
      quiz.status === 'expired' ||
      (quiz.expiresAt !== null && quiz.expiresAt <= now)
    ) {
      if (quiz.status !== 'expired') {
        await this.prisma.quiz.update({
          where: { id: quiz.id },
          data: { status: 'expired' },
        });
      }
      throw new DomainException(
        'QUIZ_EXPIRED',
        'Quiz đã hết hạn, hãy tạo quiz mới',
        HttpStatus.CONFLICT,
      );
    }
    if (quiz.status !== 'ready') {
      throw new DomainException(
        'QUIZ_NOT_READY',
        'Quiz chưa sẵn sàng để làm bài',
        HttpStatus.CONFLICT,
      );
    }

    const questions = await this.prisma.quizQuestion.findMany({
      where: { quizId },
      orderBy: { ordinal: 'asc' },
    });
    if (questions.length === 0) {
      throw new DomainException(
        'QUIZ_NOT_READY',
        'Quiz chưa có câu hỏi',
        HttpStatus.CONFLICT,
      );
    }

    const sessionId = uuidv7();
    const mode = sessionModeFor(
      quiz.quizType,
      questions[0].questionType as QuizQuestionType,
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.studySession.create({
        data: {
          id: sessionId,
          userId,
          profileId: quiz.profileId,
          kind: 'quiz',
          mode,
          collectionId: quiz.collectionId,
          quizId: quiz.id,
          settings: {
            quiz_type: quiz.quizType,
            difficulty: quiz.difficulty,
          },
          itemCount: questions.length,
        },
      });
      await tx.studySessionItem.createMany({
        data: questions.map((question, index) => ({
          sessionId,
          ordinal: index + 1,
          quizQuestionId: question.id,
          prompt: buildItemPrompt(question) as Prisma.InputJsonValue,
          correctAnswer: question.correctAnswer as Prisma.InputJsonValue,
        })),
      });
    });

    return this.sessions.get(userId, sessionId);
  }

  // ----------------------------------------------------------------- utils
  private async resolveCooldown(
    userId: bigint,
    dto: CreateQuizDto,
  ): Promise<CreateQuizResponse | null> {
    const cooldownMs = this.cooldownMs();
    if (cooldownMs <= 0) {
      return null;
    }
    const last = await this.prisma.quiz.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    if (!last) {
      return null;
    }
    const elapsed = Date.now() - last.createdAt.getTime();
    if (elapsed >= cooldownMs) {
      return null;
    }

    const sameParams =
      last.quizType === dto.quiz_type &&
      last.difficulty === dto.difficulty &&
      last.questionCount === dto.question_count &&
      (last.collectionId ?? null) === (dto.collection_id ?? null);
    if (sameParams && last.status === 'ready') {
      return { ...toQuizResponse(last), reused: true };
    }

    throw new DomainException(
      'QUIZ_GENERATION_COOLDOWN',
      'Vui lòng đợi vài giây giữa hai lần tạo quiz',
      HttpStatus.TOO_MANY_REQUESTS,
      {
        retry_after_s: Math.max(1, Math.ceil((cooldownMs - elapsed) / 1000)),
      },
    );
  }

  private async latestSessionsFor(
    userId: bigint,
    quizIds: string[],
  ): Promise<Map<string, SessionRow>> {
    const result = new Map<string, SessionRow>();
    if (quizIds.length === 0) {
      return result;
    }
    const sessions = await this.prisma.studySession.findMany({
      where: { userId, quizId: { in: quizIds } },
      orderBy: { startedAt: 'desc' },
    });
    for (const session of sessions) {
      if (session.quizId !== null && !result.has(session.quizId)) {
        result.set(session.quizId, session);
      }
    }
    return result;
  }

  private async assertCollectionOwned(
    userId: bigint,
    profileId: string,
    collectionId: string,
  ): Promise<void> {
    const collection = await this.prisma.collection.findFirst({
      where: { id: collectionId, ownerId: userId, archivedAt: null },
      select: { id: true, profileId: true },
    });
    if (!collection || collection.profileId !== profileId) {
      throw new DomainException(
        'COLLECTION_NOT_FOUND',
        'Không tìm thấy bộ sưu tập',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  private async resolveTimezone(userId: bigint): Promise<string> {
    const settings = await this.prisma.userSettings.findUnique({
      where: { userId },
      select: { timezone: true },
    });
    return settings?.timezone ?? DEFAULT_TIMEZONE;
  }

  private quotaLimit(): number {
    return readPositiveInt(
      this.config.get<number | string>('AI_QUIZ_DAILY_LIMIT'),
      DEFAULT_QUIZ_DAILY_LIMIT,
    );
  }

  private cooldownMs(): number {
    return readNonNegativeInt(
      this.config.get<number | string>('AI_QUIZ_COOLDOWN_MS'),
      DEFAULT_COOLDOWN_MS,
    );
  }
}

function readPositiveInt(
  raw: number | string | undefined,
  fallback: number,
): number {
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function readNonNegativeInt(
  raw: number | string | undefined,
  fallback: number,
): number {
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.floor(parsed);
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

function quizNotFound(): DomainException {
  return new DomainException(
    'QUIZ_NOT_FOUND',
    'Không tìm thấy quiz',
    HttpStatus.NOT_FOUND,
  );
}

function sessionModeFor(
  quizType: string,
  firstQuestionType: QuizQuestionType,
): string {
  const type = quizType === 'mixed' ? firstQuestionType : quizType;
  switch (type) {
    case 'fill_blank':
      return 'typing';
    case 'matching':
      return 'matching';
    default:
      return 'multiple_choice';
  }
}

function promptKind(questionType: string): string {
  switch (questionType) {
    case 'fill_blank':
      return 'typing';
    case 'matching':
      return 'matching';
    default:
      return 'multiple_choice';
  }
}

function buildItemPrompt(question: QuizQuestionRow): Record<string, unknown> {
  const prompt: Record<string, unknown> = {
    kind: promptKind(question.questionType),
    text: question.prompt,
  };
  const options = question.options;
  if (question.questionType === 'multiple_choice' && Array.isArray(options)) {
    prompt.options = options;
  }
  if (question.questionType === 'matching' && Array.isArray(options)) {
    const entries = options.filter(
      (entry): entry is { index: number; text: string; side?: string } =>
        typeof entry === 'object' && entry !== null,
    );
    const pick = (side: string): { index: number; text: string }[] =>
      entries
        .filter((entry) => entry.side === side)
        .map((entry) => ({ index: entry.index, text: entry.text }));
    prompt.left = pick('left');
    prompt.right = pick('right');
  }
  return prompt;
}

function toQuizResponse(row: QuizRow): QuizResponse {
  return {
    id: row.id,
    collection_id: row.collectionId,
    quiz_type: row.quizType,
    difficulty: row.difficulty,
    question_count: row.questionCount,
    status: row.status,
    created_at: row.createdAt.toISOString(),
    expires_at: row.expiresAt?.toISOString() ?? null,
  };
}

function toQuestionResponse(row: QuizQuestionRow): QuizQuestionResponse {
  return {
    ordinal: row.ordinal,
    question_type: row.questionType,
    prompt: row.prompt,
    options: row.options,
    language_id: row.languageId,
  };
}

function toSessionSummary(row: SessionRow | null): QuizSessionSummary | null {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    status: row.status,
    item_count: row.itemCount,
    correct_count: row.correctCount,
    score: row.score,
    started_at: row.startedAt.toISOString(),
    finished_at: row.finishedAt?.toISOString() ?? null,
  };
}

import { PrivacyService } from '../../privacy/privacy.service';
import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
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
import { buildItemPrompt } from './quiz-session-snapshot';
import { SessionsService } from '../../sessions/sessions.service';
import { SessionDetailResponse } from '../../sessions/types/sessions.types';
import { profileLanguageScopeKey } from '../../users/profile-languages';
import { QUIZ_FEEDBACK_AFTER_ANSWER } from '../../sessions/quiz-feedback';
import { lockUser } from '../../users/user-lock';
import {
  AI_QUIZ_PROVIDER,
  AiQuizProvider,
  AiQuizGenerateInput,
} from '../providers/ai-quiz.provider';
import { AiUsageService } from '../usage/ai-usage.service';
import { CreateQuizDto, QuizListQueryDto } from './dto/quiz.dto';
import { buildQuizQuestions } from './quiz-generator';
import {
  canonicalQuestionTypes,
  metadataSchema,
  readQuestionMetadata,
  QUIZ_VERSION,
  QuizQuestionMetadata,
} from './quiz-contract';
import { QuizSourceRepository } from './repositories/quiz-source.repository';
import {
  CreateQuizResponse,
  QuizDetailResponse,
  QuizListResponse,
  QuizQuestionResponse,
  QuizResponse,
  QuizSessionSummary,
} from './types/quiz.types';
import { QUIZ_M115_VERSION } from './bank/quiz-bank-gate';
import { QuizBankRepository } from './bank/quiz-bank.repository';
import {
  assembleQuizFromBank,
  evaluateBankEligibility,
} from './bank/quiz-bank-assembler';
import {
  QuizEligibilityDto,
  QuizEligibilityResponse,
  QuizQuestionReportResponse,
  ReportQuizQuestionDto,
} from './dto/quiz-bank.dto';

const DEFAULT_QUIZ_DAILY_LIMIT = 15;
const DEFAULT_COOLDOWN_MS = 15_000;
const QUIZ_TTL_DAYS = 7;
const DEFAULT_PAGE = 20;
const MAX_PAGE = 100;
const DETAIL_SESSIONS = 5;
const QUIZ_PROMPT_VERSION = QUIZ_VERSION;
const QUIZ_TX_OPTIONS = { maxWait: 10_000, timeout: 15_000 };

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
  generator?: unknown;
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
  settings?: unknown;
  id: string;
  quizId: string | null;
  status: string;
  itemCount: number;
  correctCount: number;
  score: number | null;
  startedAt: Date;
  finishedAt: Date | null;
}

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
    private readonly privacy: PrivacyService,
    @Optional() private readonly bankRepo?: QuizBankRepository,
  ) {}

  // ---------------------------------------------------------------- M11.5 eligibility
  async eligibility(
    userId: bigint,
    dto: QuizEligibilityDto,
  ): Promise<QuizEligibilityResponse> {
    const profile = await this.srs.getProfileContext(userId);
    if (
      ![profile.primaryLanguageId, profile.secondaryLanguageId].includes(
        dto.language_id,
      )
    ) {
      throw new DomainException(
        'QUIZ_LANGUAGE_NOT_IN_PROFILE',
        'Ngôn ngữ không thuộc hồ sơ hiện tại',
        HttpStatus.CONFLICT,
      );
    }
    if (dto.collection_id) {
      const owned = await this.prisma.collection.findFirst({
        where: {
          id: dto.collection_id,
          ownerId: userId,
          profileId: profile.id,
          archivedAt: null,
        },
        select: { id: true },
      });
      if (!owned) {
        throw new DomainException(
          'COLLECTION_NOT_FOUND',
          'Không tìm thấy bộ sưu tập',
          HttpStatus.NOT_FOUND,
        );
      }
    }

    const raw = await this.sourceRepo.findSourceItems({
      userId,
      profileId: profile.id,
      collectionId: dto.collection_id ?? null,
      languageId: dto.language_id,
      maxItems: 501,
      enrichKanji: true,
      withExamples: false,
    });
    const items = raw.slice(0, 500);
    const senseIds = [...new Set(items.map((i) => BigInt(i.senseId)))];
    const bankRows =
      this.bankRepo && senseIds.length > 0
        ? await this.bankRepo.findActiveForSenses({
            languageId: dto.language_id,
            senseIds,
            excludeUserId: userId,
          })
        : [];

    return evaluateBankEligibility({
      items,
      bankRows,
      languageId: dto.language_id,
      skills: dto.skills,
      requestedCount: dto.question_count,
      sourceComplete: raw.length <= 500,
    });
  }

  // ---------------------------------------------------------------- create
  async create(
    userId: bigint,
    dto: CreateQuizDto,
  ): Promise<CreateQuizResponse> {
    if (dto.skills && dto.skills.length > 0) {
      return this.createFromBank(userId, dto);
    }
    return this.createLegacy(userId, dto);
  }

  private async createFromBank(
    userId: bigint,
    dto: CreateQuizDto,
  ): Promise<CreateQuizResponse> {
    if (!this.bankRepo) {
      throw new DomainException(
        'AI_PROVIDER_UNAVAILABLE',
        'Kho câu hỏi chưa được khởi tạo',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const bankRepo = this.bankRepo;
    const skills = dto.skills!;

    const result = await this.prisma.$transaction(async (tx) => {
      await lockUser(tx, userId);
      const profile = await this.srs.getProfileContextInTransaction(tx, userId);
      const targetLanguageId = dto.language_id ?? profile.primaryLanguageId;
      if (
        ![profile.primaryLanguageId, profile.secondaryLanguageId].includes(
          targetLanguageId,
        )
      ) {
        throw new DomainException(
          'QUIZ_LANGUAGE_NOT_IN_PROFILE',
          'Ngôn ngữ không thuộc hồ sơ hiện tại',
          HttpStatus.CONFLICT,
        );
      }

      if (dto.collection_id !== undefined) {
        await this.assertCollectionOwned(
          tx,
          userId,
          profile.id,
          dto.collection_id,
        );
      }

      if (dto.idempotency_key) {
        const existing = await tx.$queryRaw<QuizRow[]>(Prisma.sql`
          SELECT
            id,
            user_id AS "userId",
            profile_id AS "profileId",
            collection_id AS "collectionId",
            quiz_type AS "quizType",
            difficulty,
            question_count AS "questionCount",
            status,
            created_at AS "createdAt",
            expires_at AS "expiresAt",
            generator
          FROM app.quiz
          WHERE user_id = ${userId}
            AND profile_id = ${profile.id}::uuid
            AND status = 'ready'
            AND (expires_at IS NULL OR expires_at > now())
            AND generator->>'version' = ${QUIZ_M115_VERSION}
            AND generator->>'idempotencyKey' = ${dto.idempotency_key}
          ORDER BY created_at DESC
          LIMIT 1
        `);
        if (existing.length > 0) {
          return {
            response: { ...toQuizResponse(existing[0]), reused: true },
            missingSenseIds: [] as bigint[],
            targetLanguageId,
          };
        }
      }

      const items = await this.sourceRepo.findSourceItems(
        {
          userId,
          profileId: profile.id,
          collectionId: dto.collection_id ?? null,
          languageId: targetLanguageId,
          maxItems: 500,
          enrichKanji: true,
          withExamples: false,
        },
        tx,
      );
      const senseIds = [...new Set(items.map((i) => BigInt(i.senseId)))];
      const [bankRows, recentUsage] = await Promise.all([
        bankRepo.findActiveForSenses(
          {
            languageId: targetLanguageId,
            senseIds,
            excludeUserId: userId,
          },
          tx,
        ),
        bankRepo.findRecentQuizUsage
          ? bankRepo.findRecentQuizUsage(
              {
                userId,
                profileId: profile.id,
                languageId: targetLanguageId,
                limitQuizzes: 5,
              },
              tx,
            )
          : bankRepo
              .findRecentBankIds(
                {
                  userId,
                  profileId: profile.id,
                  languageId: targetLanguageId,
                  limitQuizzes: 5,
                },
                tx,
              )
              .then((bankIds) => ({ bankIds, senseIds: new Set<string>() })),
      ]);

      const assembled = assembleQuizFromBank({
        items,
        bankRows,
        recentBankIds: recentUsage.bankIds,
        recentSenseIds: recentUsage.senseIds,
        languageId: targetLanguageId,
        skills,
        questionCount: dto.question_count,
        idempotencyKey: dto.idempotency_key,
      });

      const distinctTypes = [
        ...new Set(assembled.questions.map((q) => q.questionType)),
      ];
      const quizType = distinctTypes.length === 1 ? distinctTypes[0] : 'mixed';
      const quizId = uuidv7();

      const itemIds = [
        ...new Set(
          assembled.questions.flatMap((q) => (q.itemId ? [q.itemId] : [])),
        ),
      ];
      const survivingItems =
        itemIds.length === 0
          ? []
          : await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
              SELECT id FROM app.collection_item
              WHERE id IN (${Prisma.join(itemIds.map((id) => Prisma.sql`${id}::uuid`))})
              ORDER BY id FOR KEY SHARE
            `);
      const survivingIds = new Set(survivingItems.map((item) => item.id));

      const created = await tx.quiz.create({
        data: {
          id: quizId,
          userId,
          profileId: profile.id,
          collectionId: dto.collection_id ?? null,
          quizType,
          difficulty: 'medium',
          questionCount: assembled.questions.length,
          generator: JSON.parse(
            JSON.stringify(assembled.metadata),
          ) as Prisma.InputJsonValue,
          status: 'ready',
          expiresAt: new Date(Date.now() + QUIZ_TTL_DAYS * 24 * 60 * 60 * 1000),
        },
      });

      await tx.quizQuestion.createMany({
        data: assembled.questions.map((question, index) => ({
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
          itemId:
            question.itemId !== null && survivingIds.has(question.itemId)
              ? question.itemId
              : null,
        })),
      });

      return {
        response: { ...toQuizResponse(created), reused: false },
        missingSenseIds: assembled.missingSenseIds,
        targetLanguageId,
      };
    }, QUIZ_TX_OPTIONS);

    // Fire-and-forget pre-warm for missing senses; never blocks or fails the HTTP response.
    if (result.missingSenseIds.length > 0) {
      void Promise.allSettled(
        result.missingSenseIds.slice(0, 15).map((senseId) =>
          bankRepo.enqueueSenseGeneration({
            senseId,
            languageId: result.targetLanguageId,
            priority: 20,
          }),
        ),
      );
    }

    return result.response;
  }

  private async createLegacy(
    userId: bigint,
    dto: CreateQuizDto,
  ): Promise<CreateQuizResponse> {
    const rawTypes = dto.question_types ?? [];
    const preparation = this.prisma.$transaction(async (tx) => {
      await lockUser(tx, userId);
      const profile = await this.srs.getProfileContextInTransaction(tx, userId);
      if (dto.collection_id !== undefined) {
        await this.assertCollectionOwned(
          tx,
          userId,
          profile.id,
          dto.collection_id,
        );
      }
      const reusable = await this.resolveCooldown(tx, userId, profile.id, dto);
      if (reusable !== null) return { kind: 'reused' as const, reusable };

      const questionTypes = canonicalQuestionTypes(rawTypes);
      const items = await this.sourceRepo.findSourceItems(
        {
          userId,
          profileId: profile.id,
          collectionId: dto.collection_id ?? null,
          enrichKanji: questionTypes.includes('multiple_choice'),
          withExamples: questionTypes.includes('multiple_choice'),
        },
        tx,
      );
      const recentQuizzes = await tx.quiz.findMany({
        where: { userId, profileId: profile.id, status: 'ready' },
        orderBy: { createdAt: 'desc' },
        take: 2,
        select: { id: true },
      });
      const recentQuestions =
        recentQuizzes.length === 0
          ? []
          : await tx.quizQuestion.findMany({
              where: {
                quizId: { in: recentQuizzes.map((quiz) => quiz.id) },
                itemId: { not: null },
              },
              select: { itemId: true },
            });
      const generatorInput: AiQuizGenerateInput = {
        beforeExternalCall: () => this.privacy.assertAiAllowed(userId),
        questionTypes,
        questionCount: dto.question_count,
        languageId: profile.primaryLanguageId,
        items,
        rng: mathRng,
        recentItemIds: [
          ...new Set(
            recentQuestions
              .map((row) => row.itemId)
              .filter((id): id is string => id !== null),
          ),
        ],
        usage: { tokensIn: 0, tokensOut: 0, calls: 0, local: 0, reused: 0 },
      };
      generatorInput.baseQuestions = buildQuizQuestions(generatorInput);
      if (questionTypes.includes('multiple_choice')) {
        const previous = await tx.quiz.findMany({
          where: { userId, profileId: profile.id, status: 'ready' },
          orderBy: { createdAt: 'desc' },
          take: 25,
          select: { generator: true },
        });
        generatorInput.contextEvidence = previous.flatMap((row) => {
          const parsed = metadataSchema.safeParse(row.generator);
          return parsed.success
            ? parsed.data.questions.flatMap((q) =>
                q.evidence ? [q.evidence] : [],
              )
            : [];
        });
      }
      const period = periodDate(localDateString(new Date(), profile.timezone));
      await this.usage.reserveDailyRequest(
        tx,
        userId,
        period,
        'quiz',
        this.quotaLimit(),
      );
      const quizId = uuidv7();
      await tx.quiz.create({
        data: {
          id: quizId,
          userId,
          profileId: profile.id,
          collectionId: dto.collection_id ?? null,
          quizType: questionTypes.length > 1 ? 'mixed' : questionTypes[0],
          difficulty: 'medium',
          questionCount: dto.question_count,
          generator: {
            provider: this.quizProvider.name,
            version: QUIZ_PROMPT_VERSION,
            questionTypes,
            questions: [],
          },
          status: 'generating',
          expiresAt: new Date(Date.now() + QUIZ_TTL_DAYS * 24 * 60 * 60 * 1000),
        },
      });
      return {
        kind: 'created' as const,
        quizId,
        generatorInput,
        period,
        scopeKey: profileLanguageScopeKey(
          profile.id,
          profile.primaryLanguageId,
          profile.secondaryLanguageId ?? null,
        ),
      };
    }, QUIZ_TX_OPTIONS);

    const prepared = await preparation.catch((error: unknown) => {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2028'
      ) {
        this.logger.warn('Quiz prepare transaction expired (P2028)');
        throw new DomainException(
          'AI_PROVIDER_UNAVAILABLE',
          'Chuẩn bị dữ liệu quiz quá thời gian; vui lòng thử lại',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      throw error;
    });
    if (prepared.kind === 'reused') return prepared.reusable;
    const { quizId, generatorInput, period, scopeKey } = prepared;

    try {
      const questions = await this.quizProvider.generate(generatorInput);
      if (questions.length !== dto.question_count)
        throw new Error('Provider returned wrong question count');
      const metadata = metadataSchema.parse({
        provider: this.quizProvider.name,
        version: QUIZ_PROMPT_VERSION,
        questionTypes: canonicalQuestionTypes(rawTypes),
        usage: generatorInput.usage,
        questions: questions.map((q, index) => ({
          ordinal: index + 1,
          style:
            q.questionStyle ??
            (q.questionType === 'multiple_choice' ? 'meaning' : q.questionType),
          context: q.context ?? null,
          evidence: q.evidence ?? null,
        })),
      });
      for (const [index, q] of questions.entries()) {
        const expected = generatorInput.baseQuestions![index];
        if (
          q.questionType !== expected.questionType ||
          metadata.questions[index].style !== expected.questionStyle
        )
          throw new Error('Provider changed question style');
      }
      const quiz = await this.prisma.$transaction(async (tx) => {
        await lockUser(tx, userId);
        const currentProfile = await this.srs.getProfileContextInTransaction(
          tx,
          userId,
        );
        if (
          profileLanguageScopeKey(
            currentProfile.id,
            currentProfile.primaryLanguageId,
            currentProfile.secondaryLanguageId ?? null,
          ) !== scopeKey
        ) {
          throw new DomainException(
            'QUIZ_SCOPE_CHANGED',
            'Hồ sơ học đã thay đổi trong lúc tạo quiz; hãy tạo lại',
            HttpStatus.CONFLICT,
          );
        }
        const itemIds = [
          ...new Set(
            questions.flatMap((question) =>
              question.itemId === null ? [] : [question.itemId],
            ),
          ),
        ];
        const survivingItems =
          itemIds.length === 0
            ? []
            : await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT id FROM app.collection_item
          WHERE id IN (${Prisma.join(itemIds.map((id) => Prisma.sql`${id}::uuid`))})
          ORDER BY id FOR KEY SHARE
        `);
        const survivingIds = new Set(survivingItems.map((item) => item.id));
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
            itemId:
              question.itemId !== null && survivingIds.has(question.itemId)
                ? question.itemId
                : null,
          })),
        });
        return tx.quiz.update({
          where: { id: quizId },
          data: {
            status: 'ready',
            questionCount: questions.length,
            generator: metadata,
          },
        });
      }, QUIZ_TX_OPTIONS);
      return { ...toQuizResponse(quiz), reused: false };
    } catch (error) {
      try {
        await this.prisma.quiz.updateMany({
          where: { id: quizId, status: 'generating' },
          data: { status: 'failed' },
        });
      } catch {
        this.logger.error(`Không thể đánh dấu quiz failed: ${quizId}`);
      }
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
    } finally {
      const usage = generatorInput.usage;
      if (usage && usage.calls > 0) {
        try {
          await this.usage.addUsage(
            this.prisma,
            userId,
            period,
            'quiz',
            usage.tokensIn,
            usage.tokensOut,
            0,
          );
        } catch {
          this.logger.error(`Không thể ghi token usage cho quiz: ${quizId}`);
        }
      }
    }
  }

  // ------------------------------------------------------------------ report
  async reportQuestion(
    userId: bigint,
    quizId: string,
    ordinal: number,
    dto: ReportQuizQuestionDto,
  ): Promise<QuizQuestionReportResponse> {
    if (!Number.isInteger(ordinal) || ordinal < 1) {
      throw new DomainException(
        'VALIDATION_FAILED',
        'Số thứ tự câu hỏi không hợp lệ',
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await lockUser(tx, userId);
      const quiz = await tx.quiz.findFirst({
        where: { id: quizId, userId },
      });
      if (!quiz) {
        throw quizNotFound();
      }
      const question = await tx.quizQuestion.findFirst({
        where: { quizId, ordinal },
        select: { id: true, ordinal: true, questionType: true },
      });
      if (!question) {
        throw new DomainException(
          'QUIZ_QUESTION_NOT_FOUND',
          'Không tìm thấy câu hỏi cần báo lỗi',
          HttpStatus.NOT_FOUND,
        );
      }

      const meta = readQuestionMetadata(
        quiz.generator,
        question.ordinal,
        question.questionType,
      );
      if (meta.bankQuestionId && this.bankRepo) {
        const reported = await this.bankRepo.reportBankQuestion(
          {
            bankQuestionId: BigInt(meta.bankQuestionId),
            userId,
            quizId,
            ordinal,
            reason: dto.reason,
            note: dto.note,
            idempotencyKey: dto.idempotency_key,
          },
          tx,
        );
        return {
          report_id: reported.reportId,
          status: reported.status,
          cache_excluded: true,
        };
      }

      const rawGen =
        typeof quiz.generator === 'object' && quiz.generator !== null
          ? ({ ...(quiz.generator as Record<string, unknown>) } as Record<
              string,
              unknown
            >)
          : {};
      const reports = Array.isArray(rawGen.reports)
        ? [...(rawGen.reports as Record<string, unknown>[])]
        : [];
      const existing = reports.find(
        (r) => r.key === dto.idempotency_key && typeof r.id === 'string',
      );
      if (existing) {
        return {
          report_id: existing.id as string,
          status: 'recorded',
          cache_excluded: true,
        };
      }
      const reportId = uuidv7();
      reports.push({
        id: reportId,
        key: dto.idempotency_key,
        ordinal,
        reason: dto.reason,
        note: dto.note ?? null,
        status: 'pending',
        at: new Date().toISOString(),
      });
      rawGen.reports = reports;
      await tx.quiz.update({
        where: { id: quizId },
        data: {
          generator: JSON.parse(
            JSON.stringify(rawGen),
          ) as Prisma.InputJsonValue,
        },
      });
      return {
        report_id: reportId,
        status: 'recorded',
        cache_excluded: true,
      };
    }, QUIZ_TX_OPTIONS);
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
      questions: questions.map((question) =>
        toQuestionResponse(
          question,
          readQuestionMetadata(
            quiz.generator,
            question.ordinal,
            question.questionType,
          ),
        ),
      ),
      sessions: sessions.map((row) => toSessionSummary(row)!).filter(Boolean),
    };
  }

  // ----------------------------------------------------------------- start
  async start(
    userId: bigint,
    quizId: string,
    intent: 'resume' | 'new_attempt' = 'resume',
    attemptKey?: string,
  ): Promise<SessionDetailResponse> {
    const actualSessionId = await this.prisma.$transaction(async (tx) => {
      await lockUser(tx, userId);
      const quiz = await tx.quiz.findFirst({
        where: { id: quizId, userId },
      });
      if (!quiz) {
        throw quizNotFound();
      }

      const genVersion =
        typeof quiz.generator === 'object' &&
        quiz.generator !== null &&
        'version' in quiz.generator &&
        typeof quiz.generator.version === 'string'
          ? quiz.generator.version
          : null;
      const isM115 = genVersion === QUIZ_M115_VERSION;

      const now = new Date();
      if (
        quiz.status === 'expired' ||
        (quiz.expiresAt !== null && quiz.expiresAt <= now)
      ) {
        if (quiz.status !== 'expired') {
          await tx.quiz.update({
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

      const questions = await tx.quizQuestion.findMany({
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
      let targetCount = questions.length;
      if (
        isM115 &&
        typeof quiz.generator === 'object' &&
        quiz.generator !== null &&
        'targetCount' in quiz.generator &&
        typeof quiz.generator.targetCount === 'number'
      ) {
        targetCount = quiz.generator.targetCount;
      }

      if (isM115) {
        const currentProfile = await this.srs.getProfileContextInTransaction(
          tx,
          userId,
        );
        if (currentProfile.id !== quiz.profileId)
          throw new DomainException(
            'QUIZ_SOURCE_CHANGED',
            'Hãy chuyển về hồ sơ của đề trước khi làm bài',
            HttpStatus.CONFLICT,
          );
        if (attemptKey) {
          const replay = await tx.studySession.findFirst({
            where: {
              userId,
              profileId: quiz.profileId,
              quizId,
              settings: { path: ['attempt_key'], equals: attemptKey },
            },
          });
          if (replay) return replay.id;
        }
        const active = await tx.studySession.findFirst({
          where: {
            userId,
            profileId: quiz.profileId,
            quizId,
            status: 'in_progress',
          },
          orderBy: { startedAt: 'desc' },
        });
        if (active && intent === 'resume') return active.id;
        if (active)
          throw new DomainException(
            'QUIZ_ATTEMPT_IN_PROGRESS',
            'Hãy làm tiếp hoặc kết thúc lượt hiện tại trước',
            HttpStatus.CONFLICT,
          );
        if (intent === 'new_attempt' && !attemptKey)
          throw new DomainException(
            'QUIZ_ATTEMPT_KEY_REQUIRED',
            'Cần key cho lượt làm mới',
            HttpStatus.BAD_REQUEST,
          );
      }
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
            ...(isM115
              ? {
                  quiz_version: QUIZ_M115_VERSION,
                  target_count: targetCount,
                  feedback_policy: QUIZ_FEEDBACK_AFTER_ANSWER,
                  attempt_key: attemptKey ?? null,
                }
              : {}),
          },
          itemCount: questions.length,
        },
      });
      await tx.studySessionItem.createMany({
        data: questions.map((question) => ({
          sessionId,
          ordinal: question.ordinal,
          quizQuestionId: question.id,
          prompt: buildItemPrompt(
            question,
            readQuestionMetadata(
              quiz.generator,
              question.ordinal,
              question.questionType,
            ),
          ) as Prisma.InputJsonValue,
          correctAnswer: question.correctAnswer as Prisma.InputJsonValue,
        })),
      });
      return sessionId;
    });

    return this.sessions.get(userId, actualSessionId);
  }

  // ----------------------------------------------------------------- utils
  private async resolveCooldown(
    tx: Prisma.TransactionClient,
    userId: bigint,
    profileId: string,
    dto: CreateQuizDto,
  ): Promise<CreateQuizResponse | null> {
    const cooldownMs = this.cooldownMs();
    if (cooldownMs <= 0) {
      return null;
    }
    const last = await tx.quiz.findFirst({
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

    const questionTypes = canonicalQuestionTypes(dto.question_types ?? []);
    const sameParams =
      last.profileId === profileId &&
      last.quizType ===
        (questionTypes.length > 1 ? 'mixed' : questionTypes[0]) &&
      last.questionCount === dto.question_count &&
      (last.collectionId ?? null) === (dto.collection_id ?? null);
    const previousConfig = metadataSchema.safeParse(last.generator);
    const sameTypeConfig =
      previousConfig.success &&
      JSON.stringify(previousConfig.data.questionTypes) ===
        JSON.stringify(questionTypes);
    if (
      sameParams &&
      sameTypeConfig &&
      last.status === 'ready' &&
      (last.expiresAt === null || last.expiresAt.getTime() > Date.now()) &&
      (last.generator as { version?: unknown } | null)?.version ===
        QUIZ_PROMPT_VERSION
    ) {
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
    tx: Prisma.TransactionClient,
    userId: bigint,
    profileId: string,
    collectionId: string,
  ): Promise<void> {
    await tx.$queryRaw`SELECT id FROM app.collection
      WHERE id = ${collectionId}::uuid AND owner_id = ${userId} FOR SHARE`;
    const collection = await tx.collection.findFirst({
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

function toQuizResponse(row: QuizRow): QuizResponse {
  const version =
    typeof row.generator === 'object' &&
    row.generator !== null &&
    'version' in row.generator
      ? row.generator.version
      : undefined;
  return {
    ...(version === QUIZ_M115_VERSION ? { content_version: version } : {}),
    id: row.id,
    collection_id: row.collectionId,
    quiz_type: row.quizType,
    question_count: row.questionCount,
    status: row.status,
    created_at: row.createdAt.toISOString(),
    expires_at: row.expiresAt?.toISOString() ?? null,
  };
}

function toQuestionResponse(
  row: QuizQuestionRow,
  metadata: QuizQuestionMetadata,
): QuizQuestionResponse {
  return {
    ordinal: row.ordinal,
    question_type: row.questionType,
    prompt: row.prompt,
    options: row.options,
    language_id: row.languageId,
    question_style: metadata.style,
    context: metadata.context,
    segments: metadata.segments ?? null,
    ...(metadata.skill
      ? { skill: metadata.skill, quality_flags: metadata.qualityFlags ?? [] }
      : {}),
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

import { HttpStatus, Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { DomainException } from '../common/errors/domain.exception';
import { PrismaService } from '../db/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { GamificationService } from '../gamification/gamification.service';
import { LEARN_AHEAD_MINUTES } from '../srs/scheduler/anki.constants';
import { mathRng } from '../srs/scheduler/fuzz';
import { selectPracticeRepresentatives } from '../srs/scheduler/queue';
import { DueRepository, DueRow } from '../srs/repositories/due.repository';
import { ReviewEngine } from '../srs/review-engine.service';
import { SrsService } from '../srs/srs.service';
import { lockUser } from '../users/user-lock';
import { AnswerSessionDto } from './dto/answer-session.dto';
import { CreateSessionDto } from './dto/create-session.dto';
import { SessionSourceRepository } from './repositories/session-source.repository';
import {
  buildSessionItem,
  CardContent,
  DistractorPool,
  gradeAnswer,
  SessionDirection,
  SessionMode,
} from './session-content';
import { gradeQuizAnswer, QuizQuestionType } from './quiz-content';
import {
  AnswerResultResponse,
  SessionDetailResponse,
  SessionItemResponse,
  SessionResponse,
} from './types/sessions.types';

const DEFAULT_SESSION_LIMIT = 20;
const DEFAULT_OPTION_COUNT = 4;

interface ItemRow {
  id: bigint;
  ordinal: number;
  srsId: bigint | null;
  faceId: string | null;
  prompt: unknown;
  correctAnswer: unknown;
  userAnswer: unknown;
  answerReceipt: unknown;
  isCorrect: boolean | null;
  rating: number | null;
  elapsedMs: number | null;
  answeredAt: Date | null;
}

interface SessionRow {
  id: string;
  kind: string;
  mode: string;
  profileId: string;
  collectionId: string | null;
  quizId: string | null;
  status: string;
  itemCount: number;
  correctCount: number;
  score: number | null;
  xpAwarded: number;
  settings: unknown;
  startedAt: Date;
  finishedAt: Date | null;
  items?: ItemRow[];
}

/** Phiên ôn: tạo snapshot đề bài, chấm đáp án ở server, cập nhật SRS qua ReviewEngine. */
@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly srs: SrsService,
    private readonly dueRepo: DueRepository,
    private readonly sourceRepo: SessionSourceRepository,
    private readonly reviewEngine: ReviewEngine,
    private readonly gamification: GamificationService,
  ) {}

  // ---------------------------------------------------------------- create
  async create(
    userId: bigint,
    dto: CreateSessionDto,
  ): Promise<SessionDetailResponse> {
    const profile = await this.srs.getProfileContext(userId);
    const limit = dto.limit ?? DEFAULT_SESSION_LIMIT;

    const rows =
      dto.kind === 'review'
        ? await this.srs.collectDueRows(userId, profile, {
            limit,
            collectionId: dto.collection_id,
          })
        : selectPracticeRepresentatives(
            await this.dueRepo.findPracticeCandidates({
              userId,
              profileId: profile.id,
              primaryLanguageId: profile.primaryLanguageId,
              secondaryLanguageId: profile.secondaryLanguageId,
              now: new Date(),
              learnAheadMinutes: 0,
              limit,
              collectionId: dto.collection_id,
            }),
          ).slice(0, limit);

    if (rows.length === 0) {
      throw new DomainException(
        'SESSION_NO_CARDS',
        'Không có thẻ phù hợp để tạo phiên ôn',
        HttpStatus.CONFLICT,
      );
    }

    const optionCount = DEFAULT_OPTION_COUNT;
    const collectionIds = [...new Set(rows.map((row) => row.collection_id))];
    const pools = new Map<number, DistractorPool>();
    for (const languageId of new Set(rows.map((row) => row.language_id))) {
      pools.set(
        languageId,
        await this.sourceRepo.buildPool({
          userId,
          profileId: profile.id,
          languageId,
          // Không loại sense trong phiên: câu nhiễu trùng đáp án đã bị lọc
          // theo text khi dựng đề (buildSessionItem).
          excludeSenseIds: [],
          preferredCollectionIds: collectionIds,
          limit: 20,
        }),
      );
    }

    const sessionId = uuidv7();
    const items = rows.map((row, index) => {
      const built = buildSessionItem(
        toCardContent(row),
        dto.mode as SessionMode,
        pools.get(row.language_id) ?? { words: [], meanings: [] },
        mathRng,
        optionCount,
      );
      return {
        ordinal: index + 1,
        srsId: row.srs_id,
        faceId: row.face_id,
        prompt: built.prompt as Prisma.InputJsonValue,
        correctAnswer: built.correctAnswer as Prisma.InputJsonValue,
      };
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.studySession.create({
        data: {
          id: sessionId,
          userId,
          profileId: profile.id,
          kind: dto.kind,
          mode: dto.mode,
          collectionId: dto.collection_id ?? null,
          settings: { option_count: optionCount },
          itemCount: items.length,
        },
      });
      await tx.studySessionItem.createMany({
        data: items.map((item) => ({
          sessionId,
          ordinal: item.ordinal,
          srsId: item.srsId,
          faceId: item.faceId,
          prompt: item.prompt,
          correctAnswer: item.correctAnswer,
        })),
      });
    });

    return this.get(userId, sessionId);
  }

  // ------------------------------------------------------------------ read
  async get(userId: bigint, sessionId: string): Promise<SessionDetailResponse> {
    const session = await this.findOwned(userId, sessionId);
    const items = session.items ?? [];
    return {
      session: toSessionResponse(
        session,
        items.filter((item) => item.answeredAt !== null).length,
      ),
      items: items.map((item) =>
        toItemResponse(item, item.answeredAt !== null),
      ),
    };
  }

  async listItems(
    userId: bigint,
    sessionId: string,
    filter: { isCorrect?: boolean },
  ): Promise<SessionItemResponse[]> {
    const session = await this.findOwned(userId, sessionId);
    return (session.items ?? [])
      .filter((item) => item.answeredAt !== null)
      .filter(
        (item) =>
          filter.isCorrect === undefined || item.isCorrect === filter.isCorrect,
      )
      .map((item) => toItemResponse(item, true));
  }

  // ---------------------------------------------------------------- answer
  async answer(
    userId: bigint,
    sessionId: string,
    dto: AnswerSessionDto,
  ): Promise<AnswerResultResponse> {
    return this.prisma.$transaction(async (tx) => {
      // Match direct review lock order: user → session → session item → SRS.
      await tx.$queryRaw`SELECT id FROM app.users WHERE id = ${userId} FOR UPDATE`;
      const session = await tx.studySession.findFirst({
        where: { id: sessionId, userId },
        include: { items: { orderBy: { ordinal: 'asc' } } },
      });
      if (!session) {
        throw new DomainException(
          'SESSION_NOT_FOUND',
          'Không tìm thấy phiên ôn',
          HttpStatus.NOT_FOUND,
        );
      }
      const item = session.items.find((entry) => entry.ordinal === dto.ordinal);
      if (!item) {
        throw new DomainException(
          'SESSION_ITEM_NOT_FOUND',
          'Không tìm thấy câu hỏi trong phiên',
          HttpStatus.NOT_FOUND,
        );
      }
      await tx.$queryRaw`SELECT id FROM app.study_session_item WHERE id = ${item.id} FOR UPDATE`;
      const freshItem = await tx.studySessionItem.findUniqueOrThrow({
        where: { id: item.id },
      });

      const questionType =
        session.kind === 'quiz'
          ? readQuizQuestionType(freshItem.prompt)
          : session.mode;
      if (freshItem.answeredAt !== null) {
        const request = canonicalizeAnswerRequest(
          questionType,
          session.kind === 'quiz',
          dto,
          false,
        );
        const receipt = parseAnswerReceipt(freshItem.answerReceipt);
        if (!receipt) {
          throw new DomainException(
            'SESSION_REPLAY_UNAVAILABLE',
            'Không có response gốc để phát lại câu trả lời này',
            HttpStatus.CONFLICT,
          );
        }
        if (stableJson(receipt.request) !== stableJson(request)) {
          throw new DomainException(
            'SESSION_IDEMPOTENCY_CONFLICT',
            'Câu hỏi đã được trả lời bằng payload khác',
            HttpStatus.CONFLICT,
          );
        }
        return receipt.response;
      }

      if (session.status !== 'in_progress') {
        throw new DomainException(
          'SESSION_CLOSED',
          'Phiên đã kết thúc',
          HttpStatus.CONFLICT,
        );
      }
      const request = canonicalizeAnswerRequest(
        questionType,
        session.kind === 'quiz',
        dto,
        true,
      );

      if (session.kind === 'quiz') {
        if (
          questionType === 'multiple_choice' &&
          !hasPromptOption(freshItem.prompt, dto.option_index)
        ) {
          throw new DomainException(
            'SESSION_ANSWER_INVALID',
            'option_index không có trong lựa chọn của câu hỏi',
            HttpStatus.BAD_REQUEST,
          );
        }
        if (
          questionType === 'matching' &&
          !hasMatchingPromptPairs(freshItem.prompt, dto.pairs)
        ) {
          throw new DomainException(
            'SESSION_ANSWER_INVALID',
            'pairs phải ghép đủ lựa chọn trong câu hỏi, mỗi index dùng một lần',
            HttpStatus.BAD_REQUEST,
          );
        }
        const gradedQuiz = gradeQuizAnswer(
          questionType as QuizQuestionType,
          freshItem.correctAnswer as Record<string, unknown>,
          {
            optionIndex: dto.option_index,
            answerText: dto.answer_text,
            pairs: dto.pairs,
          },
        );
        if (!gradedQuiz) {
          throw new DomainException(
            'SESSION_ANSWER_INVALID',
            'Câu trả lời không hợp lệ cho câu hỏi quiz',
            HttpStatus.BAD_REQUEST,
          );
        }
        const profile = await this.srs.getProfileContextInTransaction(
          tx,
          userId,
        );
        const nowInTransaction = new Date();
        const updatedQuizItem = await tx.studySessionItem.update({
          where: { id: freshItem.id },
          data: {
            userAnswer: gradedQuiz.userAnswer as Prisma.InputJsonValue,
            isCorrect: gradedQuiz.isCorrect,
            rating: gradedQuiz.rating,
            elapsedMs: dto.elapsed_ms ?? null,
            answeredAt: nowInTransaction,
          },
        });
        const activity = await this.gamification.applyActivity(tx, {
          userId,
          timezone: profile.timezone,
          now: nowInTransaction,
          ruleCode: 'quiz_correct',
          source: 'quiz',
          refKind: 'quiz',
          refId: session.quizId,
          idempotencyKey: `quiz:${session.id}:${item.ordinal}`,
          xpEligible: gradedQuiz.isCorrect,
          countsAsReview: false,
        });

        let updatedQuizSession = await tx.studySession.update({
          where: { id: session.id },
          data: {
            xpAwarded: { increment: activity.xp_amount },
            ...(gradedQuiz.isCorrect ? { correctCount: { increment: 1 } } : {}),
          },
        });
        const answeredQuiz = await tx.studySessionItem.count({
          where: { sessionId: session.id, answeredAt: { not: null } },
        });
        if (answeredQuiz >= updatedQuizSession.itemCount) {
          updatedQuizSession = await tx.studySession.update({
            where: { id: session.id },
            data: {
              status: 'completed',
              finishedAt: nowInTransaction,
              score: Math.round(
                (updatedQuizSession.correctCount /
                  updatedQuizSession.itemCount) *
                  100,
              ),
            },
          });
        }

        const response: AnswerResultResponse = {
          item: toItemResponse(updatedQuizItem, true),
          srs: null,
          xp: { amount: activity.xp_amount },
          session: toSessionResponse(updatedQuizSession, answeredQuiz),
        };
        await tx.studySessionItem.update({
          where: { id: freshItem.id },
          data: {
            answerReceipt: {
              version: 1,
              request,
              response,
            } as unknown as Prisma.InputJsonValue,
          },
        });
        return response;
      }
      if (
        (session.mode === 'multiple_choice' || session.mode === 'matching') &&
        !hasPromptOption(freshItem.prompt, dto.option_index)
      ) {
        throw new DomainException(
          'SESSION_ANSWER_INVALID',
          'option_index không có trong lựa chọn của câu hỏi',
          HttpStatus.BAD_REQUEST,
        );
      }
      const graded = gradeAnswer(
        session.mode as SessionMode,
        freshItem.correctAnswer as Record<string, unknown>,
        {
          rating: dto.rating,
          optionIndex: dto.option_index,
          answerText: dto.answer_text,
        },
      );
      if (!graded) {
        throw new DomainException(
          'SESSION_ANSWER_INVALID',
          `Câu trả lời không hợp lệ cho chế độ ${session.mode}`,
          HttpStatus.BAD_REQUEST,
        );
      }
      if (freshItem.srsId === null || freshItem.faceId === null) {
        throw new DomainException(
          'SESSION_ITEM_NOT_FOUND',
          'Câu hỏi không gắn với thẻ ôn',
          HttpStatus.NOT_FOUND,
        );
      }
      const profile = await this.srs.getProfileContextInTransaction(tx, userId);
      const srsId = freshItem.srsId;

      await tx.$queryRaw`SELECT id FROM app.srs_state WHERE id = ${srsId} FOR UPDATE`;
      const srsRow = await tx.srsState.findUniqueOrThrow({
        where: { id: srsId },
        include: {
          face: { include: { item: { include: { collection: true } } } },
        },
      });
      const nowInTransaction = new Date();
      const reviewCounts =
        session.kind === 'review'
          ? await this.srs.getDayCountsInTransaction(
              tx,
              userId,
              profile.id,
              nowInTransaction,
              profile.timezone,
            )
          : null;
      const allowedLanguage =
        srsRow.face.languageId === profile.primaryLanguageId ||
        srsRow.face.languageId === profile.secondaryLanguageId;
      const aheadEligible =
        (srsRow.state === 'learning' || srsRow.state === 'relearning') &&
        !srsRow.learningIsInterday &&
        srsRow.dueAt.getTime() <=
          nowInTransaction.getTime() + LEARN_AHEAD_MINUTES * 60_000 &&
        (await this.srs.countNormalDueInTransaction(
          tx,
          userId,
          profile,
          nowInTransaction,
          srsRow.id,
          session.collectionId ?? undefined,
          reviewCounts ?? undefined,
        )) === 0;
      const unavailable =
        srsRow.userId !== userId ||
        profile.id !== session.profileId ||
        srsRow.profileId !== session.profileId ||
        srsRow.faceId !== freshItem.faceId ||
        srsRow.face.item.collection.ownerId !== userId ||
        srsRow.face.item.collection.profileId !== session.profileId ||
        (session.collectionId !== null &&
          srsRow.face.item.collection.id !== session.collectionId) ||
        srsRow.face.item.collection.archivedAt !== null ||
        srsRow.face.item.status === 'paused' ||
        !allowedLanguage ||
        srsRow.suspended ||
        (srsRow.buriedUntil !== null && srsRow.buriedUntil > nowInTransaction);
      const notDue =
        session.kind === 'review' &&
        srsRow.dueAt > nowInTransaction &&
        !aheadEligible;
      if (unavailable) {
        throw new DomainException(
          'SRS_ITEM_UNAVAILABLE',
          'Thẻ hiện không thể ôn trong phiên này',
          HttpStatus.CONFLICT,
        );
      }
      if (notDue) {
        throw new DomainException(
          'SRS_ITEM_NOT_DUE',
          'Thẻ hiện không thể ôn trong phiên này',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (session.kind === 'review') {
        const counts = reviewCounts!;
        const queueKind =
          srsRow.state === 'new'
            ? 'new'
            : srsRow.state === 'review'
              ? 'review'
              : srsRow.learningIsInterday
                ? 'interday_learning'
                : 'intraday_learning';
        if (
          (queueKind === 'new' &&
            counts.introducedToday >= profile.srsNewPerDay) ||
          ((queueKind === 'review' || queueKind === 'interday_learning') &&
            counts.reviewsToday >= profile.srsReviewPerDay)
        ) {
          throw new DomainException(
            'SRS_DAILY_LIMIT_REACHED',
            'Đã đạt giới hạn ôn trong ngày',
            HttpStatus.CONFLICT,
          );
        }
      }
      const engine = await this.reviewEngine.applyRating(
        tx,
        {
          id: srsRow.id,
          faceId: srsRow.faceId,
          state: srsRow.state,
          easeFactor: srsRow.easeFactor,
          learningStep: srsRow.learningStep,
          scheduledDays: srsRow.scheduledDays,
          lastReviewAt: srsRow.lastReviewAt,
          introducedAt: srsRow.introducedAt,
          dueAt: srsRow.dueAt,
          profileId: srsRow.profileId,
          learningIsInterday: srsRow.learningIsInterday,
        },
        {
          userId,
          profileId: srsRow.profileId,
          itemId: srsRow.face.itemId,
          rating: graded.rating,
          mode: session.mode,
          elapsedMs: dto.elapsed_ms ?? null,
          clientReviewId: null,
          xpIdempotencyKey: `session:${session.id}:${item.ordinal}`,
          timezone: profile.timezone,
          now: nowInTransaction,
        },
      );

      const updatedItem = await tx.studySessionItem.update({
        where: { id: freshItem.id },
        data: {
          userAnswer: graded.userAnswer as Prisma.InputJsonValue,
          isCorrect: graded.isCorrect,
          rating: graded.rating,
          elapsedMs: dto.elapsed_ms ?? null,
          answeredAt: nowInTransaction,
        },
      });

      let updatedSession = await tx.studySession.update({
        where: { id: session.id },
        data: {
          xpAwarded: { increment: engine.xpAmount },
          ...(graded.isCorrect ? { correctCount: { increment: 1 } } : {}),
        },
      });
      const answered = await tx.studySessionItem.count({
        where: { sessionId: session.id, answeredAt: { not: null } },
      });
      if (answered >= updatedSession.itemCount) {
        updatedSession = await tx.studySession.update({
          where: { id: session.id },
          data: {
            status: 'completed',
            finishedAt: nowInTransaction,
            score: Math.round(
              (updatedSession.correctCount / updatedSession.itemCount) * 100,
            ),
          },
        });
      }

      const response: AnswerResultResponse = {
        item: toItemResponse(updatedItem, true),
        srs: {
          state: engine.state.state,
          due_at: engine.state.dueAt.toISOString(),
          interval_days: engine.state.scheduledDays ?? 0,
          ease_factor: engine.state.easeFactor,
          learning_step: engine.state.learningStep,
        },
        xp: { amount: engine.xpAmount },
        session: toSessionResponse(updatedSession, answered),
      };
      await tx.studySessionItem.update({
        where: { id: freshItem.id },
        data: {
          answerReceipt: {
            version: 1,
            request,
            response,
          } as unknown as Prisma.InputJsonValue,
        },
      });
      return response;
    });
  }

  // ---------------------------------------------------------------- finish
  async finish(userId: bigint, sessionId: string): Promise<SessionResponse> {
    return this.prisma.$transaction(async (tx) => {
      await lockUser(tx, userId);
      const session = await tx.studySession.findFirst({
        where: { id: sessionId, userId },
        include: { items: { orderBy: { ordinal: 'asc' } } },
      });
      if (!session) {
        throw new DomainException(
          'SESSION_NOT_FOUND',
          'Không tìm thấy phiên ôn',
          HttpStatus.NOT_FOUND,
        );
      }
      const answered = session.items.filter(
        (item) => item.answeredAt !== null,
      ).length;
      if (session.status !== 'in_progress') {
        return toSessionResponse(session, answered);
      }
      const completed = answered >= session.itemCount;
      const updated = await tx.studySession.update({
        where: { id: session.id },
        data: {
          status: completed ? 'completed' : 'abandoned',
          finishedAt: new Date(),
          score: completed
            ? Math.round((session.correctCount / session.itemCount) * 100)
            : null,
        },
      });
      return toSessionResponse(updated, answered);
    });
  }

  // ----------------------------------------------------------------- util
  private async findOwned(
    userId: bigint,
    sessionId: string,
  ): Promise<SessionRow> {
    const session = await this.prisma.studySession.findFirst({
      where: { id: sessionId, userId },
      include: { items: { orderBy: { ordinal: 'asc' } } },
    });
    if (!session) {
      throw new DomainException(
        'SESSION_NOT_FOUND',
        'Không tìm thấy phiên ôn',
        HttpStatus.NOT_FOUND,
      );
    }
    return session;
  }
}

/** Đọc loại câu hỏi quiz từ snapshot prompt (kind: multiple_choice/typing/matching). */
function readQuizQuestionType(prompt: unknown): QuizQuestionType {
  if (typeof prompt === 'object' && prompt !== null) {
    const kind = (prompt as { kind?: unknown }).kind;
    if (kind === 'multiple_choice' || kind === 'matching') {
      return kind;
    }
    if (kind === 'typing') {
      return 'fill_blank';
    }
  }
  throw new DomainException(
    'SESSION_ANSWER_INVALID',
    'Câu hỏi quiz không hợp lệ',
    HttpStatus.BAD_REQUEST,
  );
}

interface CanonicalAnswerRequest {
  question_type: string;
  answer: Record<string, unknown>;
  elapsed_ms: number | null;
}

interface AnswerReceipt {
  version: 1;
  request: CanonicalAnswerRequest;
  response: AnswerResultResponse;
}

function canonicalizeAnswerRequest(
  questionType: string,
  isQuiz: boolean,
  dto: AnswerSessionDto,
  strict: boolean,
): CanonicalAnswerRequest {
  const expectedField =
    isQuiz && questionType === 'matching'
      ? 'pairs'
      : questionType === 'flashcard'
        ? 'rating'
        : questionType === 'multiple_choice' || questionType === 'matching'
          ? 'option_index'
          : questionType === 'typing' || questionType === 'fill_blank'
            ? 'answer_text'
            : undefined;
  const fields = [
    ['rating', dto.rating],
    ['option_index', dto.option_index],
    ['answer_text', dto.answer_text],
    ['pairs', dto.pairs],
  ] as const;
  if (
    strict &&
    (expectedField === undefined ||
      fields.some(
        ([field, value]) =>
          (field === expectedField && value === undefined) ||
          (field !== expectedField && value !== undefined),
      ))
  ) {
    throw new DomainException(
      'SESSION_ANSWER_INVALID',
      'Câu trả lời thiếu trường bắt buộc hoặc có trường không phù hợp',
      HttpStatus.BAD_REQUEST,
    );
  }

  const answer: Record<string, unknown> = {};
  const expectedValue = fields.find(([field]) => field === expectedField)?.[1];
  if (expectedField !== undefined && expectedValue !== undefined) {
    if (expectedField === 'answer_text' && typeof expectedValue === 'string') {
      answer[expectedField] = expectedValue.trim().toLowerCase();
    } else if (expectedField === 'pairs' && Array.isArray(expectedValue)) {
      answer[expectedField] = expectedValue
        .map((pair) => ({
          left_index: pair.left_index,
          right_index: pair.right_index,
        }))
        .sort(
          (left, right) =>
            left.left_index - right.left_index ||
            left.right_index - right.right_index,
        );
    } else {
      answer[expectedField] = expectedValue;
    }
  }
  const unexpectedFields = fields
    .filter(([field, value]) => field !== expectedField && value !== undefined)
    .map(([field, value]) => [field, value]);
  if (unexpectedFields.length > 0) {
    answer.unexpected_fields = unexpectedFields;
  }

  return {
    question_type: `${isQuiz ? 'quiz:' : ''}${questionType}`,
    answer,
    elapsed_ms: dto.elapsed_ms ?? null,
  };
}

function parseAnswerReceipt(value: unknown): AnswerReceipt | null {
  if (!isRecord(value) || value.version !== 1) return null;
  if (!isRecord(value.request) || !isRecord(value.response)) return null;

  const { request, response } = value;
  if (
    typeof request.question_type !== 'string' ||
    !isRecord(request.answer) ||
    (request.elapsed_ms !== null &&
      (typeof request.elapsed_ms !== 'number' ||
        !Number.isFinite(request.elapsed_ms))) ||
    !isSessionItemResponse(response.item) ||
    (response.srs !== null && !isSrsResponse(response.srs)) ||
    !isRecord(response.xp) ||
    typeof response.xp.amount !== 'number' ||
    !Number.isFinite(response.xp.amount) ||
    !isSessionResponse(response.session)
  ) {
    return null;
  }
  return {
    version: 1,
    request: request as unknown as CanonicalAnswerRequest,
    response: response as unknown as AnswerResultResponse,
  };
}

function hasPromptOption(
  prompt: unknown,
  optionIndex: number | undefined,
): boolean {
  if (!Number.isInteger(optionIndex) || !isRecord(prompt)) return false;
  if (!Array.isArray(prompt.options)) return false;
  return prompt.options.some(
    (option) => isRecord(option) && option.index === optionIndex,
  );
}

function hasMatchingPromptPairs(
  prompt: unknown,
  pairs: AnswerSessionDto['pairs'],
): boolean {
  if (
    !isRecord(prompt) ||
    !Array.isArray(prompt.left) ||
    !Array.isArray(prompt.right) ||
    !Array.isArray(pairs)
  )
    return false;
  if (
    pairs.length === 0 ||
    pairs.length !== prompt.left.length ||
    pairs.length !== prompt.right.length
  )
    return false;
  const left = new Set<number>();
  const right = new Set<number>();
  for (const pair of pairs) {
    if (
      !pair ||
      !hasPromptOption({ options: prompt.left }, pair.left_index) ||
      !hasPromptOption({ options: prompt.right }, pair.right_index) ||
      left.has(pair.left_index) ||
      right.has(pair.right_index)
    )
      return false;
    left.add(pair.left_index);
    right.add(pair.right_index);
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSessionItemResponse(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.ordinal === 'number' &&
    'prompt' in value &&
    (value.srs_id === null || typeof value.srs_id === 'string') &&
    (value.face_id === null || typeof value.face_id === 'string') &&
    (value.is_correct === null || typeof value.is_correct === 'boolean') &&
    (value.rating === null || typeof value.rating === 'number') &&
    (value.elapsed_ms === null || typeof value.elapsed_ms === 'number') &&
    (value.answered_at === null || typeof value.answered_at === 'string')
  );
}

function isSessionResponse(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.kind === 'string' &&
    typeof value.mode === 'string' &&
    (value.collection_id === null || typeof value.collection_id === 'string') &&
    typeof value.status === 'string' &&
    typeof value.item_count === 'number' &&
    typeof value.answered_count === 'number' &&
    typeof value.correct_count === 'number' &&
    (value.score === null || typeof value.score === 'number') &&
    typeof value.xp_awarded === 'number' &&
    isRecord(value.settings) &&
    typeof value.started_at === 'string' &&
    (value.finished_at === null || typeof value.finished_at === 'string')
  );
}

function isSrsResponse(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.state === 'string' &&
    typeof value.due_at === 'string' &&
    typeof value.interval_days === 'number' &&
    typeof value.ease_factor === 'number' &&
    (value.learning_step === null || typeof value.learning_step === 'number')
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function toCardContent(row: DueRow): CardContent {
  return {
    direction: row.direction as SessionDirection,
    language: {
      id: row.language_id,
      code: row.lang_code,
      nameVi: row.lang_name_vi,
    },
    lemma: row.lemma,
    reading: row.reading,
    romanization: row.romanization,
    meaningVi: row.meaning_vi,
    meaningSource: row.meaning_source,
    isMachineGenerated:
      row.meaning_source === 'machine' || row.meaning_source === 'llm',
    forms: row.forms ?? [],
  };
}

function toSessionResponse(
  session: SessionRow,
  answeredCount: number,
): SessionResponse {
  return {
    id: session.id,
    kind: session.kind,
    mode: session.mode,
    collection_id: session.collectionId,
    status: session.status,
    item_count: session.itemCount,
    answered_count: answeredCount,
    correct_count: session.correctCount,
    score: session.score,
    xp_awarded: session.xpAwarded,
    settings: (session.settings ?? {}) as Record<string, unknown>,
    started_at: session.startedAt.toISOString(),
    finished_at: session.finishedAt?.toISOString() ?? null,
  };
}

function toItemResponse(
  item: ItemRow,
  revealAnswer: boolean,
): SessionItemResponse {
  const response: SessionItemResponse = {
    id: item.id.toString(),
    ordinal: item.ordinal,
    srs_id: item.srsId?.toString() ?? null,
    face_id: item.faceId,
    prompt: item.prompt,
    user_answer: item.userAnswer ?? null,
    is_correct: item.isCorrect,
    rating: item.rating,
    elapsed_ms: item.elapsedMs,
    answered_at: item.answeredAt?.toISOString() ?? null,
  };
  if (revealAnswer) {
    response.correct_answer = item.correctAnswer;
  }
  return response;
}

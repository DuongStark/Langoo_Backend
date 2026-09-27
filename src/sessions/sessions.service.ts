import { HttpStatus, Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { DomainException } from '../common/errors/domain.exception';
import { PrismaService } from '../db/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { mathRng } from '../srs/scheduler/fuzz';
import { DueRepository, DueRow } from '../srs/repositories/due.repository';
import { ReviewEngine } from '../srs/review-engine.service';
import { SrsService } from '../srs/srs.service';
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
  isCorrect: boolean | null;
  rating: number | null;
  elapsedMs: number | null;
  answeredAt: Date | null;
}

interface SessionRow {
  id: string;
  kind: string;
  mode: string;
  collectionId: string | null;
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
        ? await this.srs.collectDueRows(userId, {
            limit,
            collectionId: dto.collection_id,
          })
        : await this.dueRepo.findPracticeCandidates({
            userId,
            profileId: profile.id,
            primaryLanguageId: profile.primaryLanguageId,
            secondaryLanguageId: profile.secondaryLanguageId,
            now: new Date(),
            learnAheadMinutes: 0,
            limit,
            collectionId: dto.collection_id,
          });

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
    const session = await this.findOwned(userId, sessionId);
    const item = (session.items ?? []).find(
      (entry) => entry.ordinal === dto.ordinal,
    );
    if (!item) {
      throw new DomainException(
        'SESSION_ITEM_NOT_FOUND',
        'Không tìm thấy câu hỏi trong phiên',
        HttpStatus.NOT_FOUND,
      );
    }
    // Replay (retry mạng): trả lại kết quả đã ghi, không áp lần nữa.
    if (item.answeredAt !== null) {
      return this.buildReplay(userId, session.id, item);
    }
    if (session.status !== 'in_progress') {
      throw new DomainException(
        'SESSION_CLOSED',
        'Phiên đã kết thúc',
        HttpStatus.CONFLICT,
      );
    }

    const graded = gradeAnswer(
      session.mode as SessionMode,
      item.correctAnswer as Record<string, unknown>,
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
    if (item.srsId === null || item.faceId === null) {
      throw new DomainException(
        'SESSION_ITEM_NOT_FOUND',
        'Câu hỏi không gắn với thẻ ôn',
        HttpStatus.NOT_FOUND,
      );
    }
    const srsId = item.srsId;

    const profile = await this.srs.getProfileContext(userId);
    const now = new Date();

    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM app.study_session_item WHERE id = ${item.id} FOR UPDATE`;
      const freshItem = await tx.studySessionItem.findUniqueOrThrow({
        where: { id: item.id },
      });
      if (freshItem.answeredAt !== null) {
        return { replay: true as const, item: freshItem };
      }

      await tx.$queryRaw`SELECT id FROM app.srs_state WHERE id = ${srsId} FOR UPDATE`;
      const srsRow = await tx.srsState.findUniqueOrThrow({
        where: { id: srsId },
        include: { face: { select: { itemId: true } } },
      });
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
        },
        {
          userId,
          itemId: srsRow.face.itemId,
          rating: graded.rating,
          mode: session.mode,
          elapsedMs: dto.elapsed_ms ?? null,
          clientReviewId: null,
          xpIdempotencyKey: `session:${session.id}:${item.ordinal}`,
          timezone: profile.timezone,
          now,
        },
      );

      const updatedItem = await tx.studySessionItem.update({
        where: { id: item.id },
        data: {
          userAnswer: graded.userAnswer as Prisma.InputJsonValue,
          isCorrect: graded.isCorrect,
          rating: graded.rating,
          elapsedMs: dto.elapsed_ms ?? null,
          answeredAt: now,
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
            finishedAt: now,
            score: Math.round(
              (updatedSession.correctCount / updatedSession.itemCount) * 100,
            ),
          },
        });
      }

      return {
        replay: false as const,
        item: updatedItem,
        state: engine.state,
        xpAmount: engine.xpAmount,
        session: updatedSession,
        answered,
      };
    });

    if (outcome.replay) {
      return this.buildReplay(userId, session.id, outcome.item);
    }
    return {
      item: toItemResponse(outcome.item, true),
      srs: {
        state: outcome.state.state,
        due_at: outcome.state.dueAt.toISOString(),
        interval_days: outcome.state.scheduledDays ?? 0,
        ease_factor: outcome.state.easeFactor,
        learning_step: outcome.state.learningStep,
      },
      xp: { amount: outcome.xpAmount },
      session: toSessionResponse(outcome.session, outcome.answered),
    };
  }

  // ---------------------------------------------------------------- finish
  async finish(userId: bigint, sessionId: string): Promise<SessionResponse> {
    const session = await this.findOwned(userId, sessionId);
    const answered = (session.items ?? []).filter(
      (item) => item.answeredAt !== null,
    ).length;
    if (session.status !== 'in_progress') {
      return toSessionResponse(session, answered);
    }
    const completed = answered >= session.itemCount;
    const updated = await this.prisma.studySession.update({
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

  private async buildReplay(
    userId: bigint,
    sessionId: string,
    item: ItemRow,
  ): Promise<AnswerResultResponse> {
    const session = await this.prisma.studySession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    const answered = await this.prisma.studySessionItem.count({
      where: { sessionId, answeredAt: { not: null } },
    });
    if (item.srsId === null) {
      throw new DomainException(
        'SESSION_ITEM_NOT_FOUND',
        'Câu hỏi không gắn với thẻ ôn',
        HttpStatus.NOT_FOUND,
      );
    }
    const srsRow = await this.prisma.srsState.findUnique({
      where: { id: item.srsId },
    });
    if (!srsRow) {
      throw new DomainException(
        'SESSION_ITEM_NOT_FOUND',
        'Thẻ ôn không còn tồn tại',
        HttpStatus.NOT_FOUND,
      );
    }
    const xp = await this.prisma.xpEvent.findFirst({
      where: {
        userId,
        idempotencyKey: `session:${sessionId}:${item.ordinal}`,
      },
      select: { amount: true },
    });
    return {
      item: toItemResponse(item, true),
      srs: {
        state: srsRow.state,
        due_at: srsRow.dueAt.toISOString(),
        interval_days: srsRow.scheduledDays ?? 0,
        ease_factor: srsRow.easeFactor,
        learning_step: srsRow.learningStep,
      },
      xp: { amount: xp?.amount ?? 0 },
      session: toSessionResponse(session, answered),
    };
  }
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

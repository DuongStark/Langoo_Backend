import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException } from '../common/errors/domain.exception';
import { isUniqueViolation } from '../common/errors/prisma-errors';
import { decodeDueCursor, encodeDueCursor } from '../common/pagination/cursor';
import { nextDayStartUtc, startOfDayUtc } from '../common/time/timezone';
import { PrismaService } from '../db/prisma.service';
import {
  DEFAULT_SRS_NEW_PER_DAY,
  DEFAULT_SRS_REVIEW_PER_DAY,
  DEFAULT_TIMEZONE,
} from '../users/settings.constants';
import { CreateReviewDto } from './dto/create-review.dto';
import { DueQueryDto } from './dto/due-query.dto';
import { DueRepository, DueRow } from './repositories/due.repository';
import { SrsStatsRepository } from './repositories/srs-stats.repository';
import { LEARN_AHEAD_MINUTES } from './scheduler/anki.constants';
import { AnkiScheduler } from './scheduler/anki-scheduler';
import { CardState, Rating, SchedulerState } from './scheduler/anki.types';
import { DueBucket, DueCandidate, selectDueQueue } from './scheduler/queue';
import {
  DueCard,
  DueResult,
  LocalizedMeaning,
  LocalizedWord,
  ReviewResult,
  StatsResult,
} from './types/srs.types';

/** Trần an toàn cho số thẻ lấy từ DB mỗi lượt ghép queue (đã sắp xếp sẵn). */
const CANDIDATE_LIMIT = 1000;
const DEFAULT_DUE_LIMIT = 50;
const ACCURACY_WINDOW_DAYS = 7;

interface ResolvedProfile {
  id: string;
  primaryLanguageId: number;
  secondaryLanguageId: number | null;
  timezone: string;
  srsNewPerDay: number;
  srsReviewPerDay: number;
}

@Injectable()
export class SrsService {
  private readonly scheduler = new AnkiScheduler();

  constructor(
    private readonly prisma: PrismaService,
    private readonly dueRepo: DueRepository,
    private readonly statsRepo: SrsStatsRepository,
  ) {}

  // ------------------------------------------------------------------ due
  async getDue(userId: bigint, query: DueQueryDto): Promise<DueResult> {
    const profile = await this.resolveProfile(userId);
    const now = new Date();
    const dayStart = startOfDayUtc(now, profile.timezone);

    const dayCounts = await this.dueRepo.getDayCounts({
      userId,
      profileId: profile.id,
      dayStart,
    });
    const caps = {
      newRemaining: Math.max(
        0,
        profile.srsNewPerDay - dayCounts.introducedToday,
      ),
      reviewRemaining: Math.max(
        0,
        profile.srsReviewPerDay - dayCounts.reviewsToday,
      ),
    };

    let candidates = await this.dueRepo.findCandidates({
      userId,
      profileId: profile.id,
      primaryLanguageId: profile.primaryLanguageId,
      secondaryLanguageId: profile.secondaryLanguageId,
      now,
      learnAheadMinutes: LEARN_AHEAD_MINUTES,
      limit: CANDIDATE_LIMIT,
    });
    if (query.collection_id !== undefined) {
      candidates = candidates.filter(
        (row) => row.collection_id === query.collection_id,
      );
    }

    const queue = selectDueQueue(
      candidates.map(toCandidate),
      caps,
      query.cursor !== undefined ? decodeDueCursor(query.cursor) : null,
      query.limit ?? DEFAULT_DUE_LIMIT,
    );
    const bySrs = new Map(
      candidates.map((row) => [row.srs_id.toString(), row]),
    );
    const data = queue.rows.map((entry) =>
      toDueCard(getRow(bySrs, entry.srsId)),
    );

    return {
      data,
      next_cursor:
        queue.nextCursor !== null ? encodeDueCursor(queue.nextCursor) : null,
      counts: queue.counts,
    };
  }

  // --------------------------------------------------------------- review
  async review(userId: bigint, dto: CreateReviewDto): Promise<ReviewResult> {
    const now = new Date();
    const rating = dto.rating as Rating;

    const srs = await this.prisma.srsState.findFirst({
      where: { faceId: dto.face_id, direction: dto.direction, userId },
      include: {
        face: { include: { item: { select: { id: true } } } },
      },
    });
    if (!srs) {
      throw new DomainException(
        'SRS_ITEM_NOT_FOUND',
        'Không tìm thấy thẻ ôn',
        HttpStatus.NOT_FOUND,
      );
    }

    const settings = await this.prisma.userSettings.findUnique({
      where: { userId },
    });
    const timezone = settings?.timezone ?? DEFAULT_TIMEZONE;
    const itemId = srs.face.item.id;

    const outcome = await this.prisma.$transaction(async (tx) => {
      // Khoá hàng srs_state: tuần tự hoá 2 request cùng thẻ (kể cả retry).
      await tx.$queryRaw`SELECT id FROM app.srs_state WHERE id = ${srs.id} FOR UPDATE`;
      const current = await tx.srsState.findUniqueOrThrow({
        where: { id: srs.id },
      });

      // Idempotency trước các kiểm tra khác: retry mạng của lượt đã ghi
      // phải trả kết quả cũ, không bị chặn bởi due/suspended mới.
      if (dto.client_review_id !== undefined) {
        const existingLog = await tx.reviewLog.findFirst({
          where: { userId, clientReviewId: dto.client_review_id },
        });
        if (existingLog) {
          const xpApplied = await tx.xpEvent.findFirst({
            where: {
              userId,
              idempotencyKey: `review:${dto.client_review_id}`,
            },
            select: { amount: true },
          });
          return {
            log: existingLog,
            state: current,
            xpAmount: xpApplied?.amount ?? 0,
          };
        }
      }

      if (current.suspended) {
        throw new DomainException(
          'SRS_ITEM_SUSPENDED',
          'Thẻ đang tạm ẩn',
          HttpStatus.CONFLICT,
        );
      }
      if (current.dueAt.getTime() > now.getTime()) {
        throw new DomainException(
          'SRS_ITEM_NOT_DUE',
          'Thẻ chưa đến hạn ôn',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      const schedulerState: SchedulerState = {
        state: current.state as CardState,
        easeFactor: current.easeFactor,
        learningStep: current.learningStep,
        intervalDays: current.scheduledDays ?? 0,
      };
      const schedule = this.scheduler.schedule(schedulerState, rating, now);

      const log = await tx.reviewLog.create({
        data: {
          srsId: current.id,
          userId,
          faceId: current.faceId,
          rating,
          mode: dto.mode ?? 'flashcard',
          elapsedMs: dto.elapsed_ms ?? null,
          reviewedAt: now,
          prevState: current.state,
          clientReviewId: dto.client_review_id ?? null,
        },
      });

      const updated = await tx.srsState.update({
        where: { id: current.id },
        data: {
          state: schedule.state,
          dueAt: schedule.dueAt,
          easeFactor: schedule.easeFactor,
          learningStep: schedule.learningStep,
          scheduledDays:
            schedule.state === 'review' ? schedule.intervalDays : null,
          elapsedDays: current.lastReviewAt
            ? Math.floor(
                (now.getTime() - current.lastReviewAt.getTime()) / 86_400_000,
              )
            : null,
          reps: { increment: 1 },
          ...(current.state === 'review' && rating === 1
            ? { lapses: { increment: 1 } }
            : {}),
          introducedAt:
            current.state === 'new'
              ? (current.introducedAt ?? now)
              : current.introducedAt,
          lastReviewAt: now,
        },
      });

      // Burying nội bộ (Anki): sibling new/review của cùng item tới hết ngày.
      await tx.srsState.updateMany({
        where: {
          userId,
          face: { itemId },
          id: { not: srs.id },
          state: { in: ['new', 'review'] },
          OR: [{ buriedUntil: null }, { buriedUntil: { lte: now } }],
        },
        data: { buriedUntil: nextDayStartUtc(now, timezone) },
      });

      // XP thô +1 (cap/streak/level thuộc M8) — idempotent.
      const rule = await tx.xpRule.findUnique({ where: { code: 'review' } });
      const amount = rule?.amount ?? 1;
      const idempotencyKey =
        dto.client_review_id !== undefined
          ? `review:${dto.client_review_id}`
          : `review:${log.id.toString()}`;
      let xpAmount = 0;
      try {
        await tx.xpEvent.create({
          data: {
            userId,
            amount,
            source: 'review',
            refKind: 'review_log',
            refId: log.id.toString(),
            idempotencyKey,
          },
        });
        xpAmount = amount;
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
      }

      return { log, state: updated, xpAmount };
    });

    return {
      review_log: {
        id: outcome.log.id.toString(),
        rating: outcome.log.rating,
        mode: outcome.log.mode,
        prev_state: outcome.log.prevState,
        reviewed_at: outcome.log.reviewedAt.toISOString(),
      },
      srs: {
        state: outcome.state.state,
        due_at: outcome.state.dueAt.toISOString(),
        interval_days: outcome.state.scheduledDays ?? 0,
        ease_factor: outcome.state.easeFactor,
        learning_step: outcome.state.learningStep,
      },
      xp: { amount: outcome.xpAmount },
    };
  }

  // ---------------------------------------------------------------- stats
  async stats(userId: bigint): Promise<StatsResult> {
    const profile = await this.resolveProfile(userId);
    const now = new Date();
    const dayStart = startOfDayUtc(now, profile.timezone);
    const dayEnd = nextDayStartUtc(now, profile.timezone);

    const [counts, day, accuracy] = await Promise.all([
      this.statsRepo.getCounts({
        userId,
        profileId: profile.id,
        primaryLanguageId: profile.primaryLanguageId,
        secondaryLanguageId: profile.secondaryLanguageId,
        now,
        dayEnd,
      }),
      this.dueRepo.getDayCounts({ userId, profileId: profile.id, dayStart }),
      this.statsRepo.getAccuracy7d({
        userId,
        since: new Date(now.getTime() - ACCURACY_WINDOW_DAYS * 86_400_000),
      }),
    ]);

    return {
      due_now: counts.due_now,
      due_today: counts.due_today,
      learning: counts.learning,
      new_introduced_today: day.introducedToday,
      reviews_today: day.reviewsToday,
      accuracy_7d:
        accuracy.total > 0
          ? Math.round((accuracy.passed / accuracy.total) * 100)
          : null,
    };
  }

  // ----------------------------------------------------------------- util
  private async resolveProfile(userId: bigint): Promise<ResolvedProfile> {
    const settings = await this.prisma.userSettings.findUnique({
      where: { userId },
    });
    const timezone = settings?.timezone ?? DEFAULT_TIMEZONE;
    let profileId = settings?.activeProfileId ?? null;
    if (profileId === null) {
      const fallback = await this.prisma.studyProfile.findFirst({
        where: { userId, isDefault: true },
        select: { id: true },
      });
      profileId = fallback?.id ?? null;
    }
    if (profileId === null) {
      throw new DomainException(
        'PROFILE_REQUIRED',
        'Hãy tạo hồ sơ học trước khi ôn tập',
        HttpStatus.CONFLICT,
      );
    }
    const profile = await this.prisma.studyProfile.findFirst({
      where: { id: profileId, userId },
    });
    if (!profile) {
      throw new DomainException(
        'PROFILE_NOT_FOUND',
        'Không tìm thấy hồ sơ học',
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      id: profile.id,
      primaryLanguageId: profile.primaryLanguageId,
      secondaryLanguageId: profile.secondaryLanguageId,
      timezone,
      srsNewPerDay: settings?.srsNewPerDay ?? DEFAULT_SRS_NEW_PER_DAY,
      srsReviewPerDay: settings?.srsReviewPerDay ?? DEFAULT_SRS_REVIEW_PER_DAY,
    };
  }
}

function toCandidate(row: DueRow): DueCandidate {
  return { srsId: row.srs_id, dueAt: row.due_at, bucket: bucketOf(row.state) };
}

function bucketOf(state: string): DueBucket {
  if (state === 'learning' || state === 'relearning') {
    return 0;
  }
  return state === 'review' ? 1 : 2;
}

function getRow(bySrs: Map<string, DueRow>, srsId: bigint): DueRow {
  const row = bySrs.get(srsId.toString());
  if (!row) {
    throw new Error(`Thiếu candidate cho srs_id=${srsId.toString()}`);
  }
  return row;
}

function toDueCard(row: DueRow): DueCard {
  const word: LocalizedWord = {
    kind: 'word',
    text: row.lemma,
    reading: row.reading,
    romanization: row.romanization,
  };
  const meaning: LocalizedMeaning = { kind: 'meaning', text: row.meaning_vi };
  const recognize = row.direction === 'recognize';

  return {
    srs_id: row.srs_id.toString(),
    face_id: row.face_id,
    item_id: row.item_id,
    collection_id: row.collection_id,
    direction: row.direction,
    state: row.state,
    language: {
      id: row.language_id,
      code: row.lang_code,
      name_vi: row.lang_name_vi,
    },
    instruction: recognize
      ? 'Nhớ nghĩa tiếng Việt'
      : `Nhớ lại từ ${row.lang_name_vi}`,
    prompt: recognize ? word : meaning,
    answer: recognize ? meaning : word,
    due_at: row.due_at.toISOString(),
  };
}

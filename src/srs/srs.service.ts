import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException } from '../common/errors/domain.exception';
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
import { ReviewEngine } from './review-engine.service';
import { LEARN_AHEAD_MINUTES } from './scheduler/anki.constants';
import { Rating } from './scheduler/anki.types';
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

export type { ResolvedProfile };

@Injectable()
export class SrsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dueRepo: DueRepository,
    private readonly statsRepo: SrsStatsRepository,
    private readonly reviewEngine: ReviewEngine,
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

      const result = await this.reviewEngine.applyRating(tx, current, {
        userId,
        itemId,
        rating,
        mode: dto.mode ?? 'flashcard',
        elapsedMs: dto.elapsed_ms ?? null,
        clientReviewId: dto.client_review_id ?? null,
        xpIdempotencyKey:
          dto.client_review_id !== undefined
            ? `review:${dto.client_review_id}`
            : null,
        timezone,
        now,
      });
      return result;
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
  /** Public cho module sessions dùng chung quy tắc hồ sơ + timezone + daily cap. */
  getProfileContext(userId: bigint): Promise<ResolvedProfile> {
    return this.resolveProfile(userId);
  }

  /**
   * Thẻ đến hạn (tôn trọng daily cap + learn-ahead) — dùng bởi phiên `review`.
   * Trả về DueRow đã sắp theo queue Anki.
   */
  async collectDueRows(
    userId: bigint,
    options: { limit: number; collectionId?: string },
  ): Promise<DueRow[]> {
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
    if (options.collectionId !== undefined) {
      candidates = candidates.filter(
        (row) => row.collection_id === options.collectionId,
      );
    }
    const queue = selectDueQueue(
      candidates.map(toCandidate),
      caps,
      null,
      options.limit,
    );
    const bySrs = new Map(
      candidates.map((row) => [row.srs_id.toString(), row]),
    );
    return queue.rows.map((entry) => getRow(bySrs, entry.srsId));
  }

  /** Bật/tắt suspend một thẻ (M7) — queue M6/M7 đã lọc `suspended = false`. */
  async setSuspended(
    userId: bigint,
    faceId: string,
    direction: string,
    suspended: boolean,
  ): Promise<{ srs_id: string; state: string; suspended: boolean }> {
    const srs = await this.prisma.srsState.findFirst({
      where: { faceId, direction, userId },
      select: { id: true },
    });
    if (!srs) {
      throw new DomainException(
        'SRS_ITEM_NOT_FOUND',
        'Không tìm thấy thẻ ôn',
        HttpStatus.NOT_FOUND,
      );
    }
    const updated = await this.prisma.srsState.update({
      where: { id: srs.id },
      data: { suspended },
      select: { id: true, state: true, suspended: true },
    });
    return {
      srs_id: updated.id.toString(),
      state: updated.state,
      suspended: updated.suspended,
    };
  }

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

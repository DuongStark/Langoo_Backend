import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException } from '../common/errors/domain.exception';
import {
  decodeDueCursor,
  DueCursorValue,
  encodeDueCursor,
} from '../common/pagination/cursor';
import {
  localDateString,
  nextDayStartUtc,
  startOfDayUtc,
} from '../common/time/timezone';
import { PrismaService } from '../db/prisma.service';
import { Prisma } from '../generated/prisma/client';
import {
  DEFAULT_SRS_NEW_PER_DAY,
  DEFAULT_SRS_REVIEW_PER_DAY,
  DEFAULT_TIMEZONE,
} from '../users/settings.constants';
import { lockUser } from '../users/user-lock';
import { CreateReviewDto } from './dto/create-review.dto';
import { DueQueryDto } from './dto/due-query.dto';
import { DueRepository, DueRow } from './repositories/due.repository';
import { SrsStatsRepository } from './repositories/srs-stats.repository';
import { ReviewEngine } from './review-engine.service';
import type { TxClient } from './review-engine.service';
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
    const collectionId =
      query.collection_id === undefined
        ? undefined
        : canonicalUuid(query.collection_id);
    const cursor =
      query.cursor === undefined ? null : decodeDueCursor(query.cursor);
    if (cursor !== null) {
      assertDueCursorContext(cursor, profile, collectionId, now);
    }
    const dayEnd = nextDayStartUtc(now, profile.timezone);
    const dayStart = startOfDayUtc(now, profile.timezone);

    const dayCounts = await this.dueRepo.getDayCounts({
      userId,
      profileId: profile.id,
      dayStart,
      dayEnd,
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

    const limit = query.limit ?? DEFAULT_DUE_LIMIT;
    const phase: 'regular' | 'ahead' = cursor?.phase ?? 'regular';
    // Take one candidate snapshot so regular and ahead phases cannot disagree
    // about a row that changes between two repository reads.
    const allCandidates = await this.dueRepo.findCandidates({
      userId,
      profileId: profile.id,
      primaryLanguageId: profile.primaryLanguageId,
      secondaryLanguageId: profile.secondaryLanguageId,
      now,
      learnAheadMinutes: LEARN_AHEAD_MINUTES,
      limit: 0,
      collectionId,
      includeLearnAhead: true,
    });
    const normalCandidates = allCandidates.filter(
      (row) => row.due_at.getTime() <= now.getTime(),
    );
    const normalValues = normalCandidates.map(toCandidate);
    const normalAllQueue = selectDueQueue(
      normalValues,
      caps,
      null,
      normalValues.length,
    );
    const aheadCandidates = allCandidates.filter((row) =>
      isLearnAheadRow(row, now, LEARN_AHEAD_MINUTES),
    );
    const aheadValues = aheadCandidates.map(toCandidate);
    const aheadAllQueue = selectDueQueue(
      aheadValues,
      caps,
      null,
      aheadValues.length,
    );
    // Counts describe the complete capped queue, independently of cursor and
    // phase. This keeps page 1 and the learn-ahead page consistent.
    const counts = addDueCounts(normalAllQueue.counts, aheadAllQueue.counts);

    let rows: DueCandidate[];
    let nextCursor: DueCursorValue | null;
    let cursorPhase: 'regular' | 'ahead' = phase;
    if (phase === 'ahead') {
      const aheadQueue = selectDueQueue(aheadValues, caps, cursor, limit);
      rows = aheadQueue.rows;
      nextCursor = aheadQueue.nextCursor;
    } else {
      const normalQueue = selectDueQueue(normalValues, caps, cursor, limit);
      rows = normalQueue.rows;
      nextCursor = normalQueue.nextCursor;

      // Learn-ahead is a fallback phase. A page that happens to be the last
      // regular page must still be returned without ahead cards; the client
      // enters ahead only on the following request with that cursor.
      const regularExhausted =
        normalQueue.rows.length === 0 &&
        (cursor !== null || normalAllQueue.rows.length === 0);
      if (regularExhausted && aheadValues.length > 0) {
        const aheadQueue = selectDueQueue(aheadValues, caps, null, limit);
        rows = aheadQueue.rows;
        nextCursor = aheadQueue.nextCursor;
        cursorPhase = 'ahead';
      } else if (
        normalQueue.nextCursor === null &&
        normalQueue.rows.length > 0 &&
        aheadValues.length > 0
      ) {
        // Transition marker: the next request can switch to ahead phase.
        nextCursor = toCursorValue(
          normalQueue.rows[normalQueue.rows.length - 1],
        );
      }
    }
    const bySrs = new Map(
      [...normalCandidates, ...aheadCandidates].map((row) => [
        row.srs_id.toString(),
        row,
      ]),
    );
    const data = rows.map((entry) => toDueCard(getRow(bySrs, entry.srsId)));

    return {
      data,
      next_cursor:
        nextCursor !== null
          ? encodeDueCursor({
              ...nextCursor,
              version: 1,
              profileId: profile.id,
              collectionId: collectionId ?? null,
              day: localDateString(now, profile.timezone),
              phase: cursorPhase,
            })
          : null,
      counts,
    };
  }

  // --------------------------------------------------------------- review
  async review(userId: bigint, dto: CreateReviewDto): Promise<ReviewResult> {
    const rating = dto.rating as Rating;
    const mode = dto.mode ?? 'flashcard';
    const elapsedMs = dto.elapsed_ms ?? null;
    // UUIDs are case-insensitive identifiers. Store and compare one canonical
    // representation so a retry with a differently cased UUID is identical.
    const faceId = canonicalUuid(dto.face_id);
    const clientReviewId =
      dto.client_review_id === undefined
        ? undefined
        : canonicalUuid(dto.client_review_id);
    const collectionId =
      dto.collection_id === undefined
        ? undefined
        : canonicalUuid(dto.collection_id);
    const requestPayload = {
      face_id: faceId,
      direction: dto.direction,
      rating: dto.rating,
      mode,
      elapsed_ms: elapsedMs,
      collection_id: collectionId ?? null,
    };

    return this.prisma.$transaction(async (tx) => {
      // One user lock is the common lock root for direct reviews, sessions and XP.
      await tx.$queryRaw`SELECT id FROM app.users WHERE id = ${userId} FOR UPDATE`;
      const profile = await this.resolveProfileFrom(tx, userId);
      const receipt =
        clientReviewId === undefined
          ? null
          : await tx.srsReviewReceipt.findUnique({
              where: {
                userId_clientReviewId: {
                  userId,
                  clientReviewId,
                },
              },
            });
      if (receipt !== null) {
        if (!sameReviewPayload(receipt.requestPayload, requestPayload)) {
          throw new DomainException(
            'SRS_IDEMPOTENCY_CONFLICT',
            'client_review_id đã được dùng cho payload khác',
            HttpStatus.CONFLICT,
          );
        }
        const stored = receipt.responsePayload as {
          version?: unknown;
          response?: unknown;
          review_log?: unknown;
        };
        return (
          stored.version === 1 ? stored.response : stored
        ) as ReviewResult;
      }
      if (clientReviewId !== undefined) {
        // M6.1 receipts were introduced after review_log. A legacy keyed log
        // has no safe response snapshot; never execute that request again.
        const legacy = await tx.reviewLog.findFirst({
          where: { userId, clientReviewId },
          select: { id: true },
        });
        if (legacy !== null) {
          throw new DomainException(
            'SRS_REPLAY_UNAVAILABLE',
            'Không thể phục hồi kết quả của lượt ôn cũ',
            HttpStatus.CONFLICT,
          );
        }
      }

      const locked = await tx.srsState.findFirst({
        where: {
          faceId,
          direction: dto.direction,
          userId,
          profileId: profile.id,
        },
        select: { id: true },
      });
      if (locked !== null) {
        await tx.$queryRaw`SELECT id FROM app.srs_state WHERE id = ${locked.id} FOR UPDATE`;
      }
      const current = await tx.srsState.findFirst({
        where: {
          faceId,
          direction: dto.direction,
          userId,
          profileId: profile.id,
        },
        include: {
          face: { include: { item: { include: { collection: true } } } },
        },
      });
      if (!current) {
        throw new DomainException(
          'SRS_ITEM_NOT_FOUND',
          'Không tìm thấy thẻ ôn',
          HttpStatus.NOT_FOUND,
        );
      }
      const allowedLanguage =
        current.face.languageId === profile.primaryLanguageId ||
        current.face.languageId === profile.secondaryLanguageId;
      if (
        current.profileId !== profile.id ||
        current.face.item.collection.profileId !== profile.id ||
        current.face.item.collection.ownerId !== userId ||
        current.face.item.collection.archivedAt !== null ||
        current.face.item.status === 'paused' ||
        (collectionId !== undefined &&
          current.face.item.collection.id !== collectionId) ||
        !allowedLanguage
      ) {
        throw new DomainException(
          'SRS_ITEM_UNAVAILABLE',
          'Thẻ không thuộc phạm vi hồ sơ đang học',
          HttpStatus.CONFLICT,
        );
      }
      const now = new Date();
      const counts = await this.getDayCountsTx(
        tx,
        userId,
        profile.id,
        now,
        profile.timezone,
      );
      if (
        current.suspended ||
        (current.buriedUntil !== null && current.buriedUntil > now)
      ) {
        throw new DomainException(
          current.suspended ? 'SRS_ITEM_SUSPENDED' : 'SRS_ITEM_UNAVAILABLE',
          'Thẻ hiện không thể ôn',
          HttpStatus.CONFLICT,
        );
      }
      if (current.dueAt > now) {
        const ahead =
          (current.state === 'learning' || current.state === 'relearning') &&
          !current.learningIsInterday &&
          current.dueAt.getTime() <=
            now.getTime() + LEARN_AHEAD_MINUTES * 60_000 &&
          (await this.countNormalDue(
            tx,
            userId,
            profile,
            now,
            current.id,
            collectionId,
            counts,
          )) === 0;
        if (!ahead) {
          throw new DomainException(
            'SRS_ITEM_NOT_DUE',
            'Thẻ chưa đến hạn ôn',
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
      }
      const queueKind = queueKindForState(
        current.state,
        current.learningIsInterday,
      );
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
      const outcome = await this.reviewEngine.applyRating(tx, current, {
        userId,
        profileId: profile.id,
        itemId: current.face.item.id,
        rating,
        mode,
        elapsedMs,
        clientReviewId: clientReviewId ?? null,
        xpIdempotencyKey:
          clientReviewId === undefined ? null : `review:${clientReviewId}`,
        timezone: profile.timezone,
        now,
      });
      const response = toReviewResult(outcome);
      if (clientReviewId !== undefined) {
        await tx.srsReviewReceipt.create({
          data: {
            userId,
            clientReviewId,
            requestPayload,
            responsePayload: {
              version: 1,
              response,
            } as unknown as Prisma.InputJsonValue,
          },
        });
      }
      return response;
    });
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
      this.dueRepo.getDayCounts({
        userId,
        profileId: profile.id,
        dayStart,
        dayEnd,
      }),
      this.statsRepo.getAccuracy7d({
        userId,
        profileId: profile.id,
        since: new Date(now.getTime() - ACCURACY_WINDOW_DAYS * 86_400_000),
        until: now,
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

  /** Resolve profile/settings after the caller has acquired its user lock. */
  getProfileContextInTransaction(
    tx: TxClient,
    userId: bigint,
  ): Promise<ResolvedProfile> {
    return this.resolveProfileFrom(tx, userId);
  }

  countNormalDueInTransaction(
    tx: TxClient,
    userId: bigint,
    profile: ResolvedProfile,
    now: Date,
    currentId: bigint,
    collectionId?: string,
    counts?: { introducedToday: number; reviewsToday: number },
  ): Promise<number> {
    return this.countNormalDue(
      tx,
      userId,
      profile,
      now,
      currentId,
      collectionId,
      counts,
    );
  }

  getDayCountsInTransaction(
    tx: TxClient,
    userId: bigint,
    profileId: string,
    now: Date,
    timezone: string,
  ): Promise<{ introducedToday: number; reviewsToday: number }> {
    return this.getDayCountsTx(tx, userId, profileId, now, timezone);
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
    const dayEnd = nextDayStartUtc(now, profile.timezone);
    const dayCounts = await this.dueRepo.getDayCounts({
      userId,
      profileId: profile.id,
      dayStart,
      dayEnd,
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
    const allCandidates = await this.dueRepo.findCandidates({
      userId,
      profileId: profile.id,
      primaryLanguageId: profile.primaryLanguageId,
      secondaryLanguageId: profile.secondaryLanguageId,
      now,
      learnAheadMinutes: LEARN_AHEAD_MINUTES,
      limit: 0,
      collectionId: options.collectionId,
      includeLearnAhead: true,
    });
    const normalCandidates = allCandidates.filter(
      (row) => row.due_at.getTime() <= now.getTime(),
    );
    const normalValues = normalCandidates.map(toCandidate);
    const normalQueue = selectDueQueue(normalValues, caps, null, options.limit);
    let rows = normalQueue.rows;
    let candidates = normalCandidates;
    if (normalQueue.rows.length === 0) {
      const aheadCandidates = allCandidates.filter((row) =>
        isLearnAheadRow(row, now, LEARN_AHEAD_MINUTES),
      );
      const aheadQueue = selectDueQueue(
        aheadCandidates.map(toCandidate),
        caps,
        null,
        Math.max(0, options.limit - normalQueue.rows.length),
      );
      rows = [...normalQueue.rows, ...aheadQueue.rows];
      candidates = [...normalCandidates, ...aheadCandidates];
    }
    const bySrs = new Map(
      candidates.map((row) => [row.srs_id.toString(), row]),
    );
    return rows.map((entry) => getRow(bySrs, entry.srsId));
  }

  /** Bật/tắt suspend một thẻ (M7) — queue M6/M7 đã lọc `suspended = false`. */
  async setSuspended(
    userId: bigint,
    faceId: string,
    direction: string,
    suspended: boolean,
  ): Promise<{ srs_id: string; state: string; suspended: boolean }> {
    const updated = await this.prisma.$transaction(async (tx) => {
      await lockUser(tx, userId);
      const srs = await tx.srsState.findFirst({
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
      return tx.srsState.update({
        where: { id: srs.id },
        data: { suspended },
        select: { id: true, state: true, suspended: true },
      });
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

  private async resolveProfileFrom(
    tx: TxClient,
    userId: bigint,
  ): Promise<ResolvedProfile> {
    const settings = await tx.userSettings.findUnique({ where: { userId } });
    const timezone = settings?.timezone ?? DEFAULT_TIMEZONE;
    let profileId = settings?.activeProfileId ?? null;
    if (profileId === null) {
      const fallback = await tx.studyProfile.findFirst({
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
    const profile = await tx.studyProfile.findFirst({
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

  private async countNormalDue(
    tx: TxClient,
    userId: bigint,
    profile: ResolvedProfile,
    now: Date,
    currentId: bigint,
    collectionId?: string,
    counts?: { introducedToday: number; reviewsToday: number },
  ): Promise<number> {
    const secondary = profile.secondaryLanguageId ?? -1;
    const collectionFilter =
      collectionId === undefined
        ? Prisma.sql``
        : Prisma.sql`AND i.collection_id = ${collectionId}::uuid`;
    const newAvailable =
      counts === undefined || counts.introducedToday < profile.srsNewPerDay;
    const reviewAvailable =
      counts === undefined || counts.reviewsToday < profile.srsReviewPerDay;
    const queueFilter = Prisma.sql`
      AND (
        (s.state IN ('learning', 'relearning') AND NOT s.learning_is_interday)
        OR (
          ${reviewAvailable}
          AND (
            s.state = 'review'
            OR (s.state IN ('learning', 'relearning') AND s.learning_is_interday)
          )
        )
        OR (${newAvailable} AND s.state = 'new')
      )`;
    const rows = await tx.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count
      FROM app.srs_state s
      JOIN app.collection_item_face f ON f.id = s.face_id
      JOIN app.collection_item i ON i.id = f.item_id
      JOIN app.collection c ON c.id = i.collection_id
      WHERE s.id <> ${currentId}
        AND s.user_id = ${userId}
        AND s.profile_id = ${profile.id}
        AND c.profile_id = ${profile.id}
        AND c.owner_id = ${userId}
        AND c.archived_at IS NULL
        ${collectionFilter}
        AND i.status <> 'paused'
        AND s.suspended = false
        AND (s.buried_until IS NULL OR s.buried_until <= ${now})
        AND (f.language_id = ${profile.primaryLanguageId} OR f.language_id = ${secondary})
        ${queueFilter}
        AND s.due_at <= ${now}
    `;
    return Number(rows[0]?.count ?? 0n);
  }

  private async getDayCountsTx(
    tx: TxClient,
    userId: bigint,
    profileId: string,
    now: Date,
    timezone: string,
  ): Promise<{ introducedToday: number; reviewsToday: number }> {
    const dayStart = startOfDayUtc(now, timezone);
    const dayEnd = nextDayStartUtc(now, timezone);
    const rows = await tx.$queryRaw<{ introduced: bigint; reviews: bigint }[]>`
      SELECT
        count(*) FILTER (WHERE queue_kind_before = 'new') AS introduced,
        count(*) FILTER (
          WHERE queue_kind_before IN ('review', 'interday_learning')
        ) AS reviews
      FROM app.review_log
      WHERE user_id = ${userId}
        AND profile_id = ${profileId}
        AND reviewed_at >= ${dayStart}
        AND reviewed_at < ${dayEnd}
    `;
    return {
      introducedToday: Number(rows[0]?.introduced ?? 0n),
      reviewsToday: Number(rows[0]?.reviews ?? 0n),
    };
  }
}

function toCandidate(row: DueRow): DueCandidate {
  return {
    srsId: row.srs_id,
    dueAt: row.due_at,
    dueAtKey: row.due_at_key,
    bucket: bucketOf(row.state),
    learningIsInterday: row.learning_is_interday,
    sortKey:
      row.state === 'new'
        ? `${row.collection_id}:${String(row.item_position).padStart(10, '0')}:${row.item_id}:${row.due_at_key}:${String(row.srs_id).padStart(20, '0')}`
        : undefined,
  };
}

function assertDueCursorContext(
  cursor: ReturnType<typeof decodeDueCursor>,
  profile: ResolvedProfile,
  collectionId: string | undefined,
  now: Date,
): void {
  const expectedDay = localDateString(now, profile.timezone);
  if (
    cursor.version !== 1 ||
    cursor.profileId !== profile.id ||
    (cursor.collectionId ?? null) !== (collectionId ?? null) ||
    cursor.day !== expectedDay ||
    cursor.phase === undefined
  ) {
    throw new DomainException(
      'VALIDATION_FAILED',
      'Cursor không còn phù hợp với hàng đợi hiện tại',
      HttpStatus.BAD_REQUEST,
    );
  }
  if (
    cursor.bucket === 2
      ? typeof cursor.sortKey !== 'string' || cursor.sortKey.length === 0
      : cursor.sortKey !== undefined
  ) {
    throw new DomainException(
      'VALIDATION_FAILED',
      'Cursor không còn phù hợp với hàng đợi hiện tại',
      HttpStatus.BAD_REQUEST,
    );
  }
  if (
    (cursor.bucket === 0 && typeof cursor.interday !== 'boolean') ||
    (cursor.phase === 'ahead' && cursor.bucket !== 0)
  ) {
    throw new DomainException(
      'VALIDATION_FAILED',
      'Cursor không còn phù hợp với hàng đợi hiện tại',
      HttpStatus.BAD_REQUEST,
    );
  }
}

function sameReviewPayload(
  value: unknown,
  expected: {
    face_id: string;
    direction: string;
    rating: number;
    mode: string;
    elapsed_ms: number | null;
    collection_id: string | null;
  },
): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const actual = value as Record<string, unknown>;
  return (
    canonicalPayloadUuid(actual.face_id) === expected.face_id &&
    actual.direction === expected.direction &&
    actual.rating === expected.rating &&
    actual.mode === expected.mode &&
    actual.elapsed_ms === expected.elapsed_ms &&
    canonicalPayloadUuid(actual.collection_id) ===
      canonicalPayloadUuid(expected.collection_id)
  );
}

function canonicalUuid(value: string): string {
  return value.toLowerCase();
}

function canonicalPayloadUuid(value: unknown): string | null {
  return typeof value === 'string' ? value.toLowerCase() : null;
}

function bucketOf(state: string): DueBucket {
  if (state === 'learning' || state === 'relearning') {
    return 0;
  }
  return state === 'review' ? 1 : 2;
}

function isLearnAheadRow(row: DueRow, now: Date, minutes: number): boolean {
  return (
    (row.state === 'learning' || row.state === 'relearning') &&
    !row.learning_is_interday &&
    row.due_at > now &&
    row.due_at.getTime() <= now.getTime() + minutes * 60_000
  );
}

function toCursorValue(row: DueCandidate): DueCursorValue {
  return {
    bucket: row.bucket,
    dueAt: row.dueAtKey ?? row.dueAt.toISOString(),
    srsId: row.srsId.toString(),
    ...(row.dueAtKey === undefined && row.learningIsInterday === undefined
      ? {}
      : { interday: row.learningIsInterday ?? false }),
    ...(row.sortKey === undefined ? {} : { sortKey: row.sortKey }),
  };
}

function getRow(bySrs: Map<string, DueRow>, srsId: bigint): DueRow {
  const row = bySrs.get(srsId.toString());
  if (!row) {
    throw new Error(`Thiếu candidate cho srs_id=${srsId.toString()}`);
  }
  return row;
}

function addDueCounts(
  first: { learning: number; review: number; new: number },
  second: { learning: number; review: number; new: number },
): { learning: number; review: number; new: number } {
  return {
    learning: first.learning + second.learning,
    review: first.review + second.review,
    new: first.new + second.new,
  };
}

function toDueCard(row: DueRow): DueCard {
  const word: LocalizedWord = {
    kind: 'word',
    text: row.lemma,
    reading: row.reading,
    romanization: row.romanization,
  };
  const meaning: LocalizedMeaning = {
    kind: 'meaning',
    text: row.meaning_vi,
    meaning_source: row.meaning_source,
    is_machine_generated:
      row.meaning_source === 'machine' || row.meaning_source === 'llm',
  };
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
    meaning_source: row.meaning_source,
    is_machine_generated:
      row.meaning_source === 'machine' || row.meaning_source === 'llm',
  };
}

function queueKindForState(
  state: string,
  interday: boolean,
): 'new' | 'intraday_learning' | 'interday_learning' | 'review' {
  if (state === 'new') return 'new';
  if (state === 'review') return 'review';
  return interday ? 'interday_learning' : 'intraday_learning';
}

function toReviewResult(outcome: {
  log: {
    id: bigint;
    rating: number;
    mode: string;
    prevState: string | null;
    reviewedAt: Date;
  };
  state: {
    state: string;
    dueAt: Date;
    scheduledDays: number | null;
    easeFactor: number;
    learningStep: number | null;
  };
  xpAmount: number;
}): ReviewResult {
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

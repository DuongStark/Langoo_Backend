import { Injectable } from '@nestjs/common';
import { nextDayStartUtc } from '../common/time/timezone';
import { GamificationService } from '../gamification/gamification.service';
import { PrismaService } from '../db/prisma.service';
import { AnkiScheduler } from './scheduler/anki-scheduler';
import { CardState, Rating, SchedulerState } from './scheduler/anki.types';

/** Client Prisma trong transaction (dùng chung cho review trực tiếp và session). */
export type TxClient = Parameters<
  Parameters<PrismaService['$transaction']>[0]
>[0];

export interface SrsRowForEngine {
  id: bigint;
  faceId: string;
  state: string;
  easeFactor: number;
  learningStep: number | null;
  scheduledDays: number | null;
  lastReviewAt: Date | null;
  introducedAt: Date | null;
}

export interface ApplyRatingParams {
  userId: bigint;
  /** Item chứa face — phục vụ burying sibling. */
  itemId: string;
  rating: Rating;
  mode: string;
  elapsedMs: number | null;
  clientReviewId: string | null;
  /** Khoá chống cộng trùng XP; null → dùng `review:<log id>`. */
  xpIdempotencyKey: string | null;
  timezone: string;
  now: Date;
  burySiblings?: boolean;
}

/**
 * Một lượt trả lời trong transaction: scheduler Anki + review_log + srs_state
 * + burying nội bộ + XP thô. Dùng chung cho `POST /srs/reviews` (M6) và
 * `POST /sessions/:id/answers` (M7) — xem docs/srs.md.
 */
@Injectable()
export class ReviewEngine {
  private readonly scheduler = new AnkiScheduler();

  constructor(private readonly gamification: GamificationService) {}

  async applyRating(
    tx: TxClient,
    srs: SrsRowForEngine,
    params: ApplyRatingParams,
  ): Promise<{
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
      easeFactor: number;
      learningStep: number | null;
      scheduledDays: number | null;
    };
    xpAmount: number;
  }> {
    const { rating, now } = params;
    const schedulerState: SchedulerState = {
      state: srs.state as CardState,
      easeFactor: srs.easeFactor,
      learningStep: srs.learningStep,
      intervalDays: srs.scheduledDays ?? 0,
    };
    const schedule = this.scheduler.schedule(schedulerState, rating, now);

    const log = await tx.reviewLog.create({
      data: {
        srsId: srs.id,
        userId: params.userId,
        faceId: srs.faceId,
        rating,
        mode: params.mode,
        elapsedMs: params.elapsedMs,
        reviewedAt: now,
        prevState: srs.state,
        clientReviewId: params.clientReviewId,
      },
    });

    const updated = await tx.srsState.update({
      where: { id: srs.id },
      data: {
        state: schedule.state,
        dueAt: schedule.dueAt,
        easeFactor: schedule.easeFactor,
        learningStep: schedule.learningStep,
        scheduledDays:
          schedule.state === 'review' ? schedule.intervalDays : null,
        elapsedDays: srs.lastReviewAt
          ? Math.floor(
              (now.getTime() - srs.lastReviewAt.getTime()) / 86_400_000,
            )
          : null,
        reps: { increment: 1 },
        ...(srs.state === 'review' && rating === 1
          ? { lapses: { increment: 1 } }
          : {}),
        introducedAt:
          srs.state === 'new' ? (srs.introducedAt ?? now) : srs.introducedAt,
        lastReviewAt: now,
      },
    });

    if (params.burySiblings !== false) {
      await tx.srsState.updateMany({
        where: {
          userId: params.userId,
          face: { itemId: params.itemId },
          id: { not: srs.id },
          state: { in: ['new', 'review'] },
          OR: [{ buriedUntil: null }, { buriedUntil: { lte: now } }],
        },
        data: { buriedUntil: nextDayStartUtc(now, params.timezone) },
      });
    }

    // Gamification (M8): XP theo xp_rule + daily cap + streak_day + user_stats
    // + thành tích — chạy trong cùng transaction, idempotent theo khoá.
    const activity = await this.gamification.applyActivity(tx, {
      userId: params.userId,
      timezone: params.timezone,
      now,
      ruleCode: 'review',
      source: 'review',
      refKind: 'review_log',
      refId: log.id.toString(),
      idempotencyKey: params.xpIdempotencyKey ?? `review:${log.id.toString()}`,
    });

    return { log, state: updated, xpAmount: activity.xp_amount };
  }
}

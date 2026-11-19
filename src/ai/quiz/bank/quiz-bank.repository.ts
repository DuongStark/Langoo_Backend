import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../db/prisma.service';
import { KanjiPair } from '../../providers/ai-quiz.provider';
import {
  BankSkill,
  BankValidatedCandidate,
  QUIZ_M115_VERSION,
} from './quiz-bank-gate';

const MAX_HIGH_PRIORITY_PER_USER_DAY = 30;

export interface QuizBankGenerationJobRow {
  senseId: bigint;
  languageId: number;
  priority: number;
  attempts: number;
  replenishCycles: number;
}

export interface PublicSenseForBank {
  senseId: bigint;
  languageId: number;
  languageCode: 'en' | 'ja';
  lemma: string;
  pos: string | null;
  lexemeAttributes: unknown;
  glossVi: string | null;
  glossEn: string[];
  kanjiPairs: KanjiPair[];
}

export interface GeneratedBankVariantWrite extends BankValidatedCandidate {
  variantNo: number;
}

export interface BankQuestionRow {
  id: bigint;
  senseId: bigint;
  languageId: number;
  skill: BankSkill;
  variantNo: number;
  rubricVersion: string;
  sentenceBefore: string;
  targetSurface: string;
  sentenceAfter: string;
  sentenceHash: string;
  canonicalAnswer: string;
  fixedDistractors: string[];
  posBucket: string | null;
  excludedWords: string[];
  origin: 'generated' | 'dictionary';
  verification: 'machine_reviewed' | 'human_reviewed';
}

export function computeReporterHash(userId: bigint): string {
  return createHash('sha256')
    .update(`quiz-bank-report:${userId.toString()}`)
    .digest('hex');
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : [];
}

@Injectable()
export class QuizBankRepository {
  private currentUtcDay = '';
  private readonly userDailyHighPriority = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  async findActiveForSenses(
    params: {
      languageId: number;
      senseIds: bigint[];
      excludeUserId: bigint;
    },
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<BankQuestionRow[]> {
    if (params.senseIds.length === 0) return [];
    const rows = await client.$queryRaw<
      {
        id: bigint;
        sense_id: bigint;
        language_id: number;
        skill: string;
        variant_no: number;
        rubric_version: string;
        sentence_before: string;
        target_surface: string;
        sentence_after: string;
        sentence_hash: string;
        canonical_answer: string;
        fixed_distractors: unknown;
        pos_bucket: string | null;
        excluded_words: unknown;
        origin: string;
        verification: string;
      }[]
    >(Prisma.sql`
      SELECT
        b.id,
        b.sense_id,
        b.language_id,
        b.skill,
        b.variant_no,
        b.rubric_version,
        b.sentence_before,
        b.target_surface,
        b.sentence_after,
        b.sentence_hash,
        b.canonical_answer,
        b.fixed_distractors,
        b.pos_bucket,
        b.excluded_words,
        b.origin,
        b.verification
      FROM app.quiz_question_bank b
      WHERE b.language_id = ${params.languageId}::smallint
        AND b.sense_id IN (${Prisma.join(params.senseIds)})
        AND b.status = 'active'
        AND NOT EXISTS (
          SELECT 1
          FROM app.quiz_question_bank_report r
          WHERE r.bank_question_id = b.id
            AND (
              r.user_id = ${params.excludeUserId}
              OR r.reporter_hash = ${computeReporterHash(params.excludeUserId)}
            )
        )
      ORDER BY
        CASE b.verification WHEN 'human_reviewed' THEN 0 ELSE 1 END,
        b.sense_id ASC,
        b.skill ASC,
        b.variant_no ASC
    `);

    return rows.map((r) => ({
      id: r.id,
      senseId: r.sense_id,
      languageId: Number(r.language_id),
      skill: r.skill as BankSkill,
      variantNo: Number(r.variant_no),
      rubricVersion: r.rubric_version,
      sentenceBefore: r.sentence_before,
      targetSurface: r.target_surface,
      sentenceAfter: r.sentence_after,
      sentenceHash: r.sentence_hash,
      canonicalAnswer: r.canonical_answer,
      fixedDistractors: toStringArray(r.fixed_distractors),
      posBucket: r.pos_bucket,
      excludedWords: toStringArray(r.excluded_words),
      origin: r.origin === 'dictionary' ? 'dictionary' : 'generated',
      verification:
        r.verification === 'human_reviewed'
          ? 'human_reviewed'
          : 'machine_reviewed',
    }));
  }

  async findRecentBankIds(
    params: {
      userId: bigint;
      profileId: string;
      languageId: number;
      limitQuizzes?: number;
    },
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<Set<string>> {
    const usage = await this.findRecentQuizUsage(params, client);
    return usage.bankIds;
  }

  async findRecentQuizUsage(
    params: {
      userId: bigint;
      profileId: string;
      languageId: number;
      limitQuizzes?: number;
    },
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<{ bankIds: Set<string>; senseIds: Set<string> }> {
    const limit = Math.max(1, Math.min(10, params.limitQuizzes ?? 5));
    const rows = await client.$queryRaw<{ questions: unknown }[]>(Prisma.sql`
      SELECT q.generator->'questions' AS questions
      FROM app.quiz q
      WHERE q.user_id = ${params.userId}
        AND q.profile_id = ${params.profileId}::uuid
        AND q.status = 'ready'
        AND q.generator->>'version' = ${QUIZ_M115_VERSION}
        AND (
          q.generator->>'languageId' IS NULL
          OR q.generator->>'languageId' = ${String(params.languageId)}
        )
      ORDER BY q.created_at DESC, q.id DESC
      LIMIT ${limit}
    `);

    const bankIds = new Set<string>();
    const senseIds = new Set<string>();
    for (const row of rows) {
      if (!Array.isArray(row.questions)) continue;
      for (const q of row.questions as Record<string, unknown>[]) {
        if (!q || typeof q !== 'object') continue;
        if (typeof q.bankQuestionId === 'string') {
          bankIds.add(q.bankQuestionId);
        }
        if (Array.isArray(q.targetSenseIds)) {
          for (const sid of q.targetSenseIds as unknown[]) {
            if (typeof sid === 'string') senseIds.add(sid);
          }
        }
      }
    }
    return { bankIds, senseIds };
  }

  async reportBankQuestion(
    params: {
      bankQuestionId: bigint;
      userId: bigint;
      quizId: string;
      ordinal: number;
      reason: string;
      note?: string;
      idempotencyKey: string;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<{
    reportId: string;
    status: 'recorded' | 'quarantined';
    quarantined: boolean;
  }> {
    const run = async (client: Prisma.TransactionClient) => {
      // Serialize concurrent reports on the same bankQuestionId so 2 distinct reporters never race under READ COMMITTED
      if ('$queryRaw' in client && typeof client.$queryRaw === 'function') {
        await client.$queryRaw(
          Prisma.sql`SELECT id FROM app.quiz_question_bank WHERE id = ${params.bankQuestionId} FOR UPDATE`,
        );
      }

      const existingByIdem = await client.quizQuestionBankReport.findFirst({
        where: {
          userId: params.userId,
          idempotencyKey: params.idempotencyKey,
        },
        select: { id: true },
      });
      if (existingByIdem) {
        const currentBank = await client.quizQuestionBank.findUnique({
          where: { id: params.bankQuestionId },
          select: { status: true },
        });
        const quarantined = currentBank?.status === 'quarantined';
        return {
          reportId: existingByIdem.id,
          status: quarantined
            ? ('quarantined' as const)
            : ('recorded' as const),
          quarantined,
        };
      }

      const reporterHash = computeReporterHash(params.userId);
      let report = await client.quizQuestionBankReport.findFirst({
        where: {
          bankQuestionId: params.bankQuestionId,
          reporterHash,
        },
        select: { id: true },
      });

      if (!report) {
        report = await client.quizQuestionBankReport.create({
          data: {
            id: uuidv7(),
            bankQuestionId: params.bankQuestionId,
            userId: params.userId,
            reporterHash,
            quizId: params.quizId,
            ordinal: params.ordinal,
            reason: params.reason,
            note: params.note?.trim() || null,
            idempotencyKey: params.idempotencyKey,
            status: 'open',
          },
          select: { id: true },
        });
      }

      const distinctReporters = await client.quizQuestionBankReport.count({
        where: { bankQuestionId: params.bankQuestionId },
      });
      const currentBank = await client.quizQuestionBank.findUnique({
        where: { id: params.bankQuestionId },
        select: {
          id: true,
          senseId: true,
          languageId: true,
          status: true,
        },
      });
      if (!currentBank) {
        return {
          reportId: report.id,
          status: 'recorded' as const,
          quarantined: false,
        };
      }

      const shouldQuarantine =
        currentBank.status === 'quarantined' || distinctReporters >= 2;
      const newlyQuarantined =
        currentBank.status !== 'quarantined' && distinctReporters >= 2;

      await client.quizQuestionBank.update({
        where: { id: params.bankQuestionId },
        data: {
          reportCount: distinctReporters,
          ...(newlyQuarantined
            ? {
                status: 'quarantined',
                quarantinedAt: new Date(),
              }
            : {}),
          updatedAt: new Date(),
        },
      });

      if (newlyQuarantined) {
        await client.$executeRaw(Prisma.sql`
          INSERT INTO app.quiz_bank_generation_job (
            sense_id,
            language_id,
            status,
            priority,
            attempts,
            replenish_cycles,
            next_run_at,
            updated_at
          ) VALUES (
            ${currentBank.senseId},
            ${currentBank.languageId}::smallint,
            'queued',
            20,
            0,
            1,
            now(),
            now()
          )
          ON CONFLICT (sense_id) DO UPDATE
          SET status = 'queued',
              priority = LEAST(app.quiz_bank_generation_job.priority, 20),
              replenish_cycles = app.quiz_bank_generation_job.replenish_cycles + 1,
              next_run_at = now(),
              updated_at = now()
          WHERE app.quiz_bank_generation_job.replenish_cycles < 1
        `);
      }

      return {
        reportId: report.id,
        status: shouldQuarantine
          ? ('quarantined' as const)
          : ('recorded' as const),
        quarantined: shouldQuarantine,
      };
    };

    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  async enqueueSenseGeneration(params: {
    senseId: bigint;
    languageId: number;
    priority?: number;
  }): Promise<boolean> {
    if (![1, 2].includes(params.languageId)) return false;
    const priority = params.priority ?? 10;
    const activeCount = await this.prisma.quizQuestionBank.count({
      where: {
        senseId: params.senseId,
        status: 'active',
      },
    });
    const targetMin = params.languageId === 2 ? 4 : 2;
    if (activeCount >= targetMin) return false;

    const affected = await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO app.quiz_bank_generation_job (
        sense_id,
        language_id,
        status,
        priority,
        attempts,
        next_run_at,
        updated_at
      ) VALUES (
        ${params.senseId},
        ${params.languageId}::smallint,
        'queued',
        ${priority}::smallint,
        0,
        now(),
        now()
      )
      ON CONFLICT (sense_id) DO UPDATE
      SET status = 'queued',
          priority = LEAST(app.quiz_bank_generation_job.priority, EXCLUDED.priority),
          attempts = CASE
            WHEN app.quiz_bank_generation_job.status = 'failed' THEN 0
            ELSE app.quiz_bank_generation_job.attempts
          END,
          next_run_at = CASE
            WHEN app.quiz_bank_generation_job.status = 'failed' THEN now()
            ELSE app.quiz_bank_generation_job.next_run_at
          END,
          updated_at = now()
      WHERE app.quiz_bank_generation_job.status IN ('queued', 'failed')
    `);
    return Number(affected) > 0;
  }

  async enqueueUserSavedSenses(
    userId: bigint,
    senses: { senseId: bigint; languageId: number }[],
    now: Date = new Date(),
  ): Promise<void> {
    const eligible = senses.filter(
      (s) => s.languageId === 1 || s.languageId === 2,
    );
    if (eligible.length === 0) return;

    const utcDay = now.toISOString().slice(0, 10);
    if (this.currentUtcDay !== utcDay) {
      this.currentUtcDay = utcDay;
      this.userDailyHighPriority.clear();
    }
    if (this.userDailyHighPriority.size > 10_000) {
      this.userDailyHighPriority.clear();
    }

    const userKey = userId.toString();
    for (const s of eligible) {
      const used = this.userDailyHighPriority.get(userKey) ?? 0;
      const priority = used < MAX_HIGH_PRIORITY_PER_USER_DAY ? 10 : 50;
      const enqueued = await this.enqueueSenseGeneration({
        senseId: s.senseId,
        languageId: s.languageId,
        priority,
      });
      if (enqueued && priority === 10) {
        this.userDailyHighPriority.set(userKey, used + 1);
      }
    }
  }

  /**
   * M5.3: Đẩy nền pre-warm cho lô import lớn ở priority=50 (không ăn quota priority=10
   * của người thêm từ lẻ), có trần số lượng mỗi lần import.
   */
  async enqueueBatchImportedSenses(
    senses: { senseId: bigint; languageId: number }[],
    maxCount = 100,
  ): Promise<number> {
    if (maxCount <= 0 || senses.length === 0) return 0;
    const seen = new Set<string>();
    const eligible: { senseId: bigint; languageId: number }[] = [];
    for (const s of senses) {
      if (s.languageId !== 1 && s.languageId !== 2) continue;
      const key = s.senseId.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      eligible.push(s);
      if (eligible.length >= maxCount) break;
    }

    let enqueuedCount = 0;
    for (const s of eligible) {
      const enqueued = await this.enqueueSenseGeneration({
        senseId: s.senseId,
        languageId: s.languageId,
        priority: 50,
      });
      if (enqueued) enqueuedCount += 1;
    }
    return enqueuedCount;
  }

  async claimNextGenerationJob(
    leaseOwner: string,
    leaseSeconds = 180,
  ): Promise<QuizBankGenerationJobRow | null> {
    const rows = await this.prisma.$queryRaw<
      {
        sense_id: bigint;
        language_id: number;
        priority: number;
        attempts: number;
        replenish_cycles: number;
      }[]
    >(Prisma.sql`
      UPDATE app.quiz_bank_generation_job j
      SET status = 'running',
          attempts = j.attempts + 1,
          lease_owner = ${leaseOwner},
          lease_until = now() + (${leaseSeconds} * interval '1 second'),
          updated_at = now()
      WHERE j.sense_id = (
        SELECT c.sense_id
        FROM app.quiz_bank_generation_job c
        WHERE (c.status = 'queued' AND c.next_run_at <= now())
           OR (c.status = 'running' AND c.lease_until IS NOT NULL AND c.lease_until < now())
        ORDER BY c.priority ASC, c.next_run_at ASC, c.sense_id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING
        j.sense_id,
        j.language_id,
        j.priority,
        j.attempts,
        j.replenish_cycles
    `);
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      senseId: row.sense_id,
      languageId: Number(row.language_id),
      priority: Number(row.priority),
      attempts: Number(row.attempts),
      replenishCycles: Number(row.replenish_cycles),
    };
  }

  async loadPublicSenseForBank(
    senseId: bigint,
  ): Promise<PublicSenseForBank | null> {
    const base = await this.prisma.$queryRaw<
      {
        sense_id: bigint;
        language_id: number;
        code: string;
        lemma: string;
        pos: string | null;
        lexeme_attributes: unknown;
        gloss_vi: string | null;
        gloss_en: string[];
      }[]
    >(Prisma.sql`
      SELECT
        s.id AS sense_id,
        x.language_id,
        lg.code,
        x.lemma,
        x.pos,
        COALESCE(x.attributes, '{}'::jsonb) || jsonb_build_object('sense_tags', COALESCE(s.attributes, '{}'::jsonb)) AS lexeme_attributes,
        sc.gloss_vi,
        ARRAY(
          SELECT g.text
          FROM core.sense_gloss g
          JOIN public.language gl ON gl.id = g.language_id
          WHERE g.sense_id = s.id AND gl.code = 'en'
          ORDER BY g.rank, g.id
        ) AS gloss_en
      FROM core.sense s
      JOIN core.lexeme x ON x.id = s.lexeme_id
      JOIN public.language lg ON lg.id = x.language_id
      LEFT JOIN serve.sense_card sc ON sc.sense_id = s.id
      WHERE s.id = ${senseId}
      LIMIT 1
    `);
    if (base.length === 0) return null;
    const row = base[0];
    if (row.code !== 'en' && row.code !== 'ja') return null;

    let kanjiPairs: KanjiPair[] = [];
    if (row.code === 'ja') {
      const pairs = await this.prisma.$queryRaw<
        { written: string; reading: string; eligible: boolean }[]
      >(Prisma.sql`
        SELECT
          k.form_text AS written,
          r.form_text AS reading,
          (
            EXISTS (SELECT 1 FROM core.sense_form sf WHERE sf.sense_id = s.id AND sf.form_id = k.id)
            AND EXISTS (SELECT 1 FROM core.sense_form sf WHERE sf.sense_id = s.id AND sf.form_id = r.id)
            AND NOT EXISTS (
              SELECT 1 FROM core.lexeme_form_tag t
              WHERE t.form_id IN (k.id, r.id)
                AND t.tag_code IN ('sK', 'sk', 'iK', 'ik', 'io', 'oK', 'ok', 'rK', 'rk', 'ateji')
            )
          ) AS eligible
        FROM core.sense s
        JOIN core.lexeme x ON x.id = s.lexeme_id
        JOIN core.lexeme_form k ON k.lexeme_id = x.id AND k.kind = 'kanji'
        JOIN core.lexeme_form r ON r.lexeme_id = x.id AND r.kind = 'kana'
        JOIN core.lexeme_form_applies_to a ON a.form_id = r.id AND a.target_form_id = k.id
        WHERE s.id = ${senseId}
        ORDER BY k.form_order, r.form_order
      `);
      kanjiPairs = pairs.map((p) => ({
        written: p.written,
        reading: p.reading,
        eligible: p.eligible,
      }));
      const written = [...new Set(kanjiPairs.map((p) => p.written))];
      if (written.length > 0) {
        const aliases = await this.prisma.$queryRaw<
          { written: string; reading: string }[]
        >(Prisma.sql`
          SELECT DISTINCT k.form_text AS written, r.form_text AS reading
          FROM core.lexeme_form k
          JOIN core.lexeme_form_applies_to a ON a.target_form_id = k.id
          JOIN core.lexeme_form r ON r.id = a.form_id AND r.kind = 'kana'
          WHERE k.kind = 'kanji' AND k.form_text IN (${Prisma.join(written)})
        `);
        for (const alias of aliases) {
          if (
            !kanjiPairs.some(
              (p) => p.written === alias.written && p.reading === alias.reading,
            )
          ) {
            kanjiPairs.push({
              written: alias.written,
              reading: alias.reading,
              eligible: false,
            });
          }
        }
      }
    }

    return {
      senseId: row.sense_id,
      languageId: Number(row.language_id),
      languageCode: row.code,
      lemma: row.lemma,
      pos: row.pos,
      lexemeAttributes: row.lexeme_attributes,
      glossVi: row.gloss_vi,
      glossEn: row.gloss_en ?? [],
      kanjiPairs,
    };
  }

  async saveGeneratedBankVariants(params: {
    senseId: bigint;
    languageId: number;
    generatorModel: string;
    validatorModel: string;
    variants: GeneratedBankVariantWrite[];
  }): Promise<number> {
    if (params.variants.length === 0) return 0;
    let written = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const v of params.variants) {
        const affected = await tx.$executeRaw(Prisma.sql`
          INSERT INTO app.quiz_question_bank (
            sense_id,
            language_id,
            skill,
            variant_no,
            rubric_version,
            sentence_before,
            target_surface,
            sentence_after,
            sentence_hash,
            canonical_answer,
            fixed_distractors,
            pos_bucket,
            excluded_words,
            origin,
            verification,
            generator_model,
            validator_model,
            status,
            updated_at
          ) VALUES (
            ${params.senseId},
            ${params.languageId}::smallint,
            ${v.skill},
            ${v.variantNo}::smallint,
            ${QUIZ_M115_VERSION},
            ${v.sentenceBefore},
            ${v.targetSurface},
            ${v.sentenceAfter},
            ${v.sentenceHash},
            ${v.canonicalAnswer},
            ${JSON.stringify(v.fixedDistractors)}::jsonb,
            ${v.posBucket},
            ${JSON.stringify(v.excludedWords)}::jsonb,
            'generated',
            'machine_reviewed',
            ${params.generatorModel},
            ${params.validatorModel},
            'active',
            now()
          )
          ON CONFLICT (sense_id, skill, rubric_version, variant_no) DO UPDATE
          SET sentence_before = EXCLUDED.sentence_before,
              target_surface = EXCLUDED.target_surface,
              sentence_after = EXCLUDED.sentence_after,
              sentence_hash = EXCLUDED.sentence_hash,
              canonical_answer = EXCLUDED.canonical_answer,
              fixed_distractors = EXCLUDED.fixed_distractors,
              pos_bucket = EXCLUDED.pos_bucket,
              excluded_words = EXCLUDED.excluded_words,
              generator_model = EXCLUDED.generator_model,
              validator_model = EXCLUDED.validator_model,
              status = 'active',
              updated_at = now()
          WHERE app.quiz_question_bank.verification <> 'human_reviewed'
            AND app.quiz_question_bank.status <> 'quarantined'
        `);
        written += Number(affected);
      }
    });
    return written;
  }

  async markGenerationJobDone(senseId: bigint): Promise<void> {
    await this.prisma.quizBankGenerationJob.update({
      where: { senseId },
      data: {
        status: 'done',
        leaseOwner: null,
        leaseUntil: null,
        lastError: null,
        updatedAt: new Date(),
      },
    });
  }

  async markGenerationJobIneligible(
    senseId: bigint,
    reason = 'ineligible_sense',
  ): Promise<void> {
    await this.prisma.quizBankGenerationJob.update({
      where: { senseId },
      data: {
        status: 'ineligible',
        leaseOwner: null,
        leaseUntil: null,
        lastError: reason.slice(0, 300),
        updatedAt: new Date(),
      },
    });
  }

  async rescheduleOrFailGenerationJob(params: {
    senseId: bigint;
    attempts: number;
    error: string;
  }): Promise<void> {
    const safeError = params.error.slice(0, 300);
    if (params.attempts >= 3) {
      await this.prisma.quizBankGenerationJob.update({
        where: { senseId: params.senseId },
        data: {
          status: 'failed',
          leaseOwner: null,
          leaseUntil: null,
          lastError: safeError,
          updatedAt: new Date(),
        },
      });
      return;
    }
    const backoffMs = 60_000 * Math.pow(2, Math.max(0, params.attempts - 1));
    await this.prisma.quizBankGenerationJob.update({
      where: { senseId: params.senseId },
      data: {
        status: 'queued',
        leaseOwner: null,
        leaseUntil: null,
        lastError: safeError,
        nextRunAt: new Date(Date.now() + backoffMs),
        updatedAt: new Date(),
      },
    });
  }
}

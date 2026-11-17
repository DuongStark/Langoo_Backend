import {
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../db/prisma.service';
import { SrsService } from '../../../srs/srs.service';
import { PrivacyService } from '../../../privacy/privacy.service';
import { AiUsageService } from '../../usage/ai-usage.service';
import { lockUser } from '../../../users/user-lock';
import { localDateString } from '../../../common/time/timezone';
import { DomainException } from '../../../common/errors/domain.exception';
import { profileLanguageScopeKey } from '../../../users/profile-languages';
import { QuizSourceRepository } from '../repositories/quiz-source.repository';
import { QuizSourceItem } from '../../providers/ai-quiz.provider';
import { AiChatResult } from '../../providers/ai-chat.provider';
import { fingerprint } from '../quiz-contract';
import { planQuiz, QuizSlot, QUIZ_V3 } from './quiz-blueprint';
import { QuizBatchEngine, ValidatedQuestion } from './quiz-batch-engine';
import { recentQuizContent } from './quiz-cache.repository';
import {
  CreateQuizJobDto,
  QuizEligibilityDto,
  QuizEligibilityResponse,
  QuizJobResponse,
  ReportQuizQuestionDto,
  QuizQuestionReportResponse,
} from './quiz-v3.dto';

type State =
  'queued' | 'running' | 'needs_action' | 'ready' | 'failed' | 'cancelled';
interface CallReceipt {
  id: string;
  state: 'pending' | 'recorded';
}
export interface QuizJobMetadata {
  reports?: {
    id: string;
    key: string;
    hash: string;
    ordinal: number;
    reason: string;
    note?: string;
    cacheKey: string;
    status: 'pending';
    at: string;
  }[];
  version: typeof QUIZ_V3;
  job: {
    revision: number;
    state: State;
    phase?: 'prepare' | 'generate' | 'audit';
    key: string;
    requestHash: string;
    scopeKey: string;
    period: string;
    round: number;
    lease: string | null;
    leaseUntil: number;
    deadline: number;
    reason: string | null;
    usageUncertain: boolean;
    calls: CallReceipt[];
  };
  input: QuizEligibilityDto;
  sourceHash: string;
  source: QuizSourceItem[];
  slots: QuizSlot[];
  content: ValidatedQuestion[];
  audited: boolean;
  questions: {
    ordinal: number;
    style: string;
    context: unknown;
    evidence: null;
    skill: string;
    qualityFlags: string[];
  }[];
}
interface JobRow {
  id: string;
  userId: bigint;
  profileId: string;
  generator: unknown;
  status: string;
  expiresAt: Date | null;
}
const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
function read(value: unknown): QuizJobMetadata {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('version' in value) ||
    value.version !== QUIZ_V3 ||
    !('job' in value) ||
    !('source' in value) ||
    !Array.isArray(value.source) ||
    !('slots' in value) ||
    !Array.isArray(value.slots) ||
    !('content' in value) ||
    !Array.isArray(value.content)
  )
    throw new Error('Invalid quiz job metadata');
  return value as QuizJobMetadata;
}
const snapshotHash = (source: QuizSourceItem[]) =>
  fingerprint(
    source
      .map((s) => ({
        itemId: s.itemId,
        faceId: s.faceId,
        senseId: s.senseId,
        languageId: s.languageId,
        lemma: s.lemma,
        meaning: s.meaningVi,
        pos: s.pos,
        reading: s.reading,
        pairs: s.kanjiPairs,
        gloss: s.glossEn,
        machine: s.glossViMachine,
      }))
      .sort(
        (a, b) =>
          a.itemId.localeCompare(b.itemId) ||
          a.senseId.localeCompare(b.senseId),
      ),
  );
const fail = (
  code: string,
  message: string,
  status: number = HttpStatus.CONFLICT,
): never => {
  throw new DomainException(code, message, status);
};

@Injectable()
export class QuizJobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QuizJobsService.name);
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly srs: SrsService,
    private readonly privacy: PrivacyService,
    private readonly usage: AiUsageService,
    private readonly sources: QuizSourceRepository,
    private readonly engine: QuizBatchEngine,
  ) {}
  private enabled(): boolean {
    return this.config.get<boolean>('AI_QUIZ_V3_ENABLED') === true;
  }
  private assertEnabled(): void {
    if (!this.enabled())
      fail(
        'QUIZ_V3_DISABLED',
        'Luồng quiz mới chưa được bật',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
  }
  onModuleInit(): void {
    if (!this.enabled()) return;
    this.timer = setInterval(() => {
      void this.tick().catch(() => this.logger.warn('Quiz job tick failed'));
    }, 2000);
    this.timer.unref();
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async prepare(userId: bigint, input: QuizEligibilityDto) {
    const profile = await this.srs.getProfileContext(userId);
    if (
      ![profile.primaryLanguageId, profile.secondaryLanguageId].includes(
        input.language_id,
      )
    )
      fail(
        'QUIZ_LANGUAGE_NOT_IN_PROFILE',
        'Ngôn ngữ không thuộc hồ sơ hiện tại',
      );
    if (input.collection_id) {
      const owned = await this.prisma.collection.findFirst({
        where: {
          id: input.collection_id,
          ownerId: userId,
          profileId: profile.id,
        },
        select: { id: true },
      });
      if (!owned)
        fail(
          'COLLECTION_NOT_FOUND',
          'Không tìm thấy bộ từ',
          HttpStatus.NOT_FOUND,
        );
    }
    const raw = await this.sources.findSourceItems({
      userId,
      profileId: profile.id,
      collectionId: input.collection_id ?? null,
      languageId: input.language_id,
      maxItems: 501,
      enrichKanji: true,
      withExamples: false,
    });
    const source = raw.slice(0, 500);
    const plan = planQuiz(
      source,
      input.language_id,
      input.skills,
      input.question_count,
    );
    return { profile, source, complete: raw.length <= 500, plan };
  }
  async eligibility(
    userId: bigint,
    input: QuizEligibilityDto,
  ): Promise<QuizEligibilityResponse> {
    this.assertEnabled();
    const { source, complete, plan } = await this.prepare(userId, input);
    const reasons: string[] = [];
    if (input.skills.includes('paraphrase'))
      reasons.push('CURATED_PARAPHRASE_SOURCE_NOT_READY');
    const needsModel =
      input.skills.some((s) => !['meaning', 'matching'].includes(s)) ||
      input.skills.length > 1;
    if (needsModel && !this.engine.available())
      reasons.push('AI_MODELS_NOT_CONFIGURED');
    if (!plan.feasible)
      reasons.push(
        complete
          ? 'INSUFFICIENT_ELIGIBLE_SOURCE'
          : 'SOURCE_WINDOW_LIMIT_REACHED',
      );
    let suggested: number | null = null;
    if (!reasons.includes('AI_MODELS_NOT_CONFIGURED')) {
      // Demand per skill only increases with count, so capacity is monotonic.
      let low = input.skills.length,
        high = input.question_count;
      while (low <= high) {
        const n = Math.floor((low + high) / 2);
        if (planQuiz(source, input.language_id, input.skills, n).feasible) {
          suggested = n;
          low = n + 1;
        } else high = n - 1;
      }
    }
    return {
      feasible: plan.feasible && reasons.length === 0,
      eligible_target_count: plan.targetCount,
      requested_count: input.question_count,
      suggested_count: suggested,
      by_skill: plan.bySkill.map((s) => ({
        skill: s.skill,
        requested: s.requested,
        eligible_targets: s.eligibleTargets,
        source_policy:
          s.skill === 'paraphrase'
            ? 'unavailable'
            : s.skill === 'kanji_reading'
              ? 'reading_rule'
              : s.skill === 'usage'
                ? 'same_word_sentences'
                : 'collection_only',
      })),
      reasons,
      source_complete: complete,
      level_filter_supported: false,
      sample_sources_supported: false,
    };
  }

  async create(
    userId: bigint,
    dto: CreateQuizJobDto,
  ): Promise<QuizJobResponse> {
    this.assertEnabled();
    const input: QuizEligibilityDto = {
      collection_id: dto.collection_id,
      language_id: dto.language_id,
      skills: dto.skills,
      question_count: dto.question_count,
    };
    const receipt = await this.prisma.quiz.findFirst({
      where: {
        userId,
        generator: { path: ['job', 'key'], equals: dto.idempotency_key },
      },
    });
    if (receipt) {
      if (
        read(receipt.generator).job.requestHash !==
        fingerprint([receipt.profileId, input])
      )
        fail('QUIZ_IDEMPOTENCY_CONFLICT', 'Key đã dùng cho một cấu hình khác');
      return this.response(receipt);
    }
    const prepared = await this.prepare(userId, dto);
    const { profile } = prepared;
    const source = [...prepared.source];
    for (let i = source.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [source[i], source[j]] = [source[j], source[i]];
    }
    const history = await recentQuizContent(
      this.prisma,
      userId,
      profile.id,
      dto.language_id,
    );
    const recent = new Set(
      history
        .slice(0, 2)
        .flatMap((h) =>
          h.questions.flatMap((q) => q.targets.map((t) => t.senseId)),
        ),
    );
    source.sort(
      (a, b) => Number(recent.has(a.senseId)) - Number(recent.has(b.senseId)),
    );
    const plan = planQuiz(
      source,
      dto.language_id,
      dto.skills,
      dto.question_count,
    );
    if (
      dto.skills.some((s) => !['meaning', 'matching'].includes(s)) ||
      dto.skills.length > 1
    )
      await this.privacy.assertAiAllowed(userId);
    const requestHash = fingerprint([profile.id, input]);
    const scopeKey = profileLanguageScopeKey(
      profile.id,
      profile.primaryLanguageId,
      profile.secondaryLanguageId ?? null,
    );
    const row = await this.prisma.$transaction(
      async (tx) => {
        await lockUser(tx, userId);
        // Replay before capacity/quota checks: a source edit must not create a second job.
        const previous = await tx.quiz.findFirst({
          where: {
            userId,
            generator: { path: ['job', 'key'], equals: dto.idempotency_key },
          },
        });
        if (previous) {
          const meta = read(previous.generator);
          if (meta.job.requestHash !== fingerprint([previous.profileId, input]))
            fail(
              'QUIZ_IDEMPOTENCY_CONFLICT',
              'Key đã dùng cho một cấu hình khác',
            );
          return previous;
        }
        const current = await this.srs.getProfileContextInTransaction(
          tx,
          userId,
        );
        if (
          profileLanguageScopeKey(
            current.id,
            current.primaryLanguageId,
            current.secondaryLanguageId ?? null,
          ) !== scopeKey
        )
          fail(
            'QUIZ_SOURCE_CHANGED',
            'Hồ sơ đã thay đổi; hãy kiểm tra lại cấu hình',
          );
        if (!plan.feasible)
          fail('QUIZ_NOT_ENOUGH_ITEMS', 'Chưa đủ dữ liệu cho cấu hình đề này');
        if (
          (dto.skills.some((s) => !['meaning', 'matching'].includes(s)) ||
            dto.skills.length > 1) &&
          !this.engine.available()
        )
          fail(
            'AI_PROVIDER_UNAVAILABLE',
            'Chưa cấu hình model tạo và kiểm định quiz',
            HttpStatus.SERVICE_UNAVAILABLE,
          );
        const active = await tx.quiz.findFirst({
          where: {
            userId,
            profileId: profile.id,
            status: 'generating',
            expiresAt: { gt: new Date() },
            generator: { path: ['version'], equals: QUIZ_V3 },
            AND: [
              {
                generator: {
                  path: ['input', 'language_id'],
                  equals: dto.language_id,
                },
              },
            ],
          },
          select: { id: true },
        });
        if (active)
          throw new DomainException(
            'QUIZ_JOB_ALREADY_ACTIVE',
            'Bạn đang có đề chưa hoàn tất; hãy làm tiếp hoặc hủy đề đó',
            HttpStatus.CONFLICT,
            { quiz_id: active.id },
          );
        const period = localDateString(new Date(), profile.timezone);
        await this.usage.reserveDailyRequest(
          tx,
          userId,
          new Date(period),
          'quiz',
          this.config.get<number>('AI_QUIZ_DAILY_LIMIT') ?? 15,
        );
        const metadata: QuizJobMetadata = {
          version: QUIZ_V3,
          input,
          sourceHash: snapshotHash(source),
          source,
          slots: plan.slots,
          content: [],
          audited: false,
          questions: [],
          job: {
            revision: 0,
            state: 'queued',
            key: dto.idempotency_key,
            requestHash,
            scopeKey,
            period,
            round: 1,
            lease: null,
            leaseUntil: 0,
            deadline: 0,
            reason: null,
            usageUncertain: false,
            calls: [],
          },
        };
        return tx.quiz.create({
          data: {
            id: uuidv7(),
            userId,
            profileId: profile.id,
            collectionId: dto.collection_id ?? null,
            quizType: dto.skills.every((s) => s === 'matching')
              ? 'matching'
              : dto.skills.includes('matching')
                ? 'mixed'
                : 'multiple_choice',
            difficulty: 'medium',
            questionCount: dto.question_count,
            generator: json(metadata),
            status: 'generating',
            expiresAt: new Date(Date.now() + 7 * 86400_000),
          },
        });
      },
      { timeout: 15_000, maxWait: 10_000 },
    );
    return this.response(row);
  }

  private async owned(userId: bigint, id: string): Promise<JobRow> {
    const profile = await this.srs.getProfileContext(userId);
    const row = await this.prisma.quiz.findFirst({
      where: {
        id,
        userId,
        profileId: profile.id,
        generator: { path: ['version'], equals: QUIZ_V3 },
      },
    });
    if (!row)
      return fail(
        'QUIZ_NOT_FOUND',
        'Không tìm thấy quiz',
        HttpStatus.NOT_FOUND,
      );
    return row;
  }
  async get(userId: bigint, id: string): Promise<QuizJobResponse> {
    this.assertEnabled();
    const row = await this.owned(userId, id);
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now())
      await this.expire(id);
    return this.response(await this.owned(userId, id));
  }
  private async expire(id: string): Promise<void> {
    await this.mutate(id, (m) => {
      if (!['queued', 'running', 'needs_action'].includes(m.job.state)) return;
      m.job.state = 'failed';
      m.job.reason = 'QUIZ_EXPIRED';
      m.job.lease = null;
      m.content = [];
      m.source = [];
      m.audited = false;
    });
  }
  private response(row: JobRow): QuizJobResponse {
    const m = read(row.generator);
    const allowed =
      m.job.state === 'needs_action'
        ? [
            ...(m.job.round < 3 && m.job.reason !== 'QUIZ_SOURCE_CHANGED'
              ? ['retry']
              : []),
            ...(m.audited &&
            m.content.length &&
            m.job.reason !== 'QUIZ_SOURCE_CHANGED'
              ? ['accept_shorter']
              : []),
            'cancel',
          ]
        : ['queued', 'running'].includes(m.job.state)
          ? ['cancel']
          : [];
    return {
      quiz_id: row.id,
      state: m.job.state,
      phase:
        m.job.state === 'running'
          ? (m.job.phase ?? 'prepare')
          : m.job.state === 'queued'
            ? 'queued'
            : m.job.state === 'ready'
              ? 'complete'
              : m.job.state === 'needs_action'
                ? 'waiting'
                : 'terminal',
      requested_count: m.input.question_count,
      validated_count: m.content.length,
      by_skill: m.input.skills.map((skill) => ({
        skill,
        requested: m.slots.filter((s) => s.skill === skill).length,
        validated: m.content.filter((q) => q.skill === skill).length,
      })),
      allowed_actions: allowed,
      reason: m.job.reason,
      usage_uncertain: m.job.usageUncertain,
    };
  }

  /** CAS serializes workers/actions without holding a DB transaction over AI. */
  private async mutate(
    id: string,
    change: (m: QuizJobMetadata) => void,
    lease?: string,
  ): Promise<QuizJobMetadata> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const row = await this.prisma.quiz.findUnique({ where: { id } });
      if (!row) throw new Error('Quiz job deleted');
      const meta = read(row.generator);
      const revision = meta.job.revision;
      if (lease && (meta.job.lease !== lease || meta.job.state !== 'running'))
        throw new Error('Quiz lease lost');
      change(meta);
      meta.job.revision++;
      const status =
        meta.job.state === 'ready'
          ? 'ready'
          : ['failed', 'cancelled'].includes(meta.job.state)
            ? 'failed'
            : 'generating';
      const result = await this.prisma.quiz.updateMany({
        where: {
          id,
          generator: { path: ['job', 'revision'], equals: revision },
        },
        data: { generator: json(meta), status },
      });
      if (result.count === 1) return meta;
    }
    throw new Error('Quiz revision conflict');
  }
  async action(
    userId: bigint,
    id: string,
    action: 'retry' | 'accept_shorter' | 'cancel',
  ): Promise<QuizJobResponse> {
    this.assertEnabled();
    const row = await this.owned(userId, id);
    const meta = read(row.generator);
    if (action === 'accept_shorter') {
      if (meta.job.state === 'ready') return this.response(row);
      if (
        meta.job.state !== 'needs_action' ||
        !meta.audited ||
        !meta.content.length ||
        meta.job.reason === 'QUIZ_SOURCE_CHANGED'
      )
        fail('QUIZ_ACTION_NOT_ALLOWED', 'Chưa thể nhận đề ngắn');
      // The worker has already audited the exact saved content before needs_action.
      await this.publish(row, meta);
    } else {
      await this.mutate(id, (m) => {
        if (action === 'cancel') {
          if (m.job.state === 'cancelled') return;
          if (!['queued', 'running', 'needs_action'].includes(m.job.state))
            fail('QUIZ_ACTION_NOT_ALLOWED', 'Không thể hủy đề đã kết thúc');
          m.job.state = 'cancelled';
          m.job.lease = null;
        } else {
          if (['queued', 'running'].includes(m.job.state) && m.job.round > 1)
            return;
          if (
            m.job.state !== 'needs_action' ||
            m.job.round >= 3 ||
            m.job.reason === 'QUIZ_SOURCE_CHANGED'
          )
            fail('QUIZ_ACTION_NOT_ALLOWED', 'Không thể thử tiếp tác vụ này');
          m.job.state = 'queued';
          m.job.round++;
          m.job.reason = null;
          m.job.lease = null;
        }
      });
    }
    return this.get(userId, id);
  }

  async report(
    userId: bigint,
    id: string,
    ordinal: number,
    dto: ReportQuizQuestionDto,
  ): Promise<QuizQuestionReportResponse> {
    this.assertEnabled();
    await this.owned(userId, id);
    if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 50)
      fail(
        'VALIDATION_FAILED',
        'Ordinal phải từ1đến50',
        HttpStatus.BAD_REQUEST,
      );
    const hash = fingerprint([ordinal, dto.reason, dto.note ?? null]);
    const meta = await this.mutate(id, (m) => {
      if (m.job.state !== 'ready')
        fail('QUIZ_NOT_READY', 'Chỉ báo nội dung của đề đã sẵn sàng');
      const existing = m.reports?.find((r) => r.key === dto.idempotency_key);
      if (existing) {
        if (existing.hash !== hash)
          fail('QUIZ_IDEMPOTENCY_CONFLICT', 'Key đã dùng cho phản hồi khác');
        return;
      }
      const question = [...m.content].sort((a, b) => a.ordinal - b.ordinal)[
        ordinal - 1
      ];
      if (!question || m.reports?.some((r) => r.ordinal === ordinal))
        fail(
          'QUIZ_REPORT_NOT_AVAILABLE',
          'Câu không tồn tại hoặc đã có phản hồi đang chờ',
        );
      const reports = m.reports ?? [];
      if (reports.length >= 50)
        fail('QUIZ_REPORT_LIMIT', 'Đã đủ số phản hồi cho đề này');
      reports.push({
        id: uuidv7(),
        key: dto.idempotency_key,
        hash,
        ordinal,
        reason: dto.reason,
        ...(dto.note === undefined ? {} : { note: dto.note }),
        cacheKey: question.cacheKey,
        status: 'pending',
        at: new Date().toISOString(),
      });
      m.reports = reports;
      const publicMeta = m.questions.find((q) => q.ordinal === ordinal);
      if (publicMeta && !publicMeta.qualityFlags.includes('reported_pending'))
        publicMeta.qualityFlags.push('reported_pending');
    });
    const receipt = meta.reports?.find((r) => r.key === dto.idempotency_key);
    if (!receipt) throw new Error('Missing report receipt');
    return { report_id: receipt.id, status: 'pending', cache_excluded: true };
  }

  async tick(): Promise<void> {
    if (!this.enabled() || this.busy) return;
    this.busy = true;
    try {
      const rows = await this.prisma.quiz.findMany({
        where: {
          status: 'generating',
          generator: { path: ['version'], equals: QUIZ_V3 },
          OR: [
            { generator: { path: ['job', 'state'], equals: 'queued' } },
            { generator: { path: ['job', 'state'], equals: 'running' } },
          ],
        },
        orderBy: { createdAt: 'asc' },
        take: 10,
      });
      for (const row of rows) {
        if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
          await this.expire(row.id);
          continue;
        }
        const m = read(row.generator);
        if (m.job.state === 'running' && m.job.leaseUntil > Date.now())
          continue;
        const lease = uuidv7();
        const budget =
          this.config.get<number>('AI_QUIZ_V3_BUDGET_MS') ?? 120_000;
        try {
          await this.mutate(row.id, (current) => {
            if (
              (current.job.state === 'running' &&
                current.job.leaseUntil > Date.now()) ||
              !['queued', 'running'].includes(current.job.state)
            )
              throw new Error('Quiz already claimed');
            if (current.job.state === 'running') {
              current.job.usageUncertain ||= current.job.calls.some(
                (c) => c.state === 'pending',
              );
              current.job.round++;
              if (current.job.round > 3) {
                current.job.state = 'failed';
                current.job.reason = 'QUIZ_RECOVERY_EXHAUSTED';
                return;
              }
            }
            current.job.state = 'running';
            current.job.phase = 'prepare';
            current.job.lease = lease;
            current.job.deadline = Date.now() + budget;
            current.job.leaseUntil = Date.now() + budget + 30_000;
          });
          await this.run(row, lease);
        } catch (error) {
          // A competing worker/action can win the CAS. Never overwrite its state.
          await this.mutate(row.id, (current) => {
            if (current.job.lease !== lease || current.job.state !== 'running')
              return;
            const code = error instanceof DomainException ? error.code : '';
            const sourceChanged = [
              'PROFILE_NOT_FOUND',
              'PROFILE_REQUIRED',
              'QUIZ_LANGUAGE_NOT_IN_PROFILE',
              'COLLECTION_NOT_FOUND',
              'QUIZ_SOURCE_CHANGED',
            ].includes(code);
            current.job.state = code.startsWith('PRIVACY_')
              ? 'failed'
              : 'needs_action';
            current.job.reason = sourceChanged
              ? 'QUIZ_SOURCE_CHANGED'
              : code.startsWith('PRIVACY_')
                ? code
                : 'QUIZ_GENERATION_INCOMPLETE';
            current.job.lease = null;
            if (sourceChanged) {
              current.content = [];
              current.audited = false;
            }
            current.job.usageUncertain ||= current.job.calls.some(
              (c) => c.state === 'pending',
            );
          }).catch(() => undefined);
        }
        break;
      }
    } finally {
      this.busy = false;
    }
  }

  private async recordUsage(
    id: string,
    userId: bigint,
    period: string,
    callId: string,
    result: AiChatResult,
  ): Promise<void> {
    // Receipt and aggregate commit together; late responses after cancel still
    // account for provider cost, without reviving the job or overwriting content.
    for (let attempt = 0; attempt < 5; attempt++) {
      const success = await this.prisma.$transaction(async (tx) => {
        const row = await tx.quiz.findUnique({ where: { id } });
        if (!row) return true;
        const m = read(row.generator);
        const receipt = m.job.calls.find((c) => c.id === callId);
        if (!receipt || receipt.state === 'recorded') return true;
        receipt.state = 'recorded';
        m.job.usageUncertain ||= !!result.usageEstimated;
        const revision = m.job.revision++;
        const updated = await tx.quiz.updateMany({
          where: {
            id,
            generator: { path: ['job', 'revision'], equals: revision },
          },
          data: { generator: json(m) },
        });
        if (!updated.count) return false;
        await this.usage.addUsage(
          tx,
          userId,
          new Date(period),
          'quiz',
          result.tokensIn,
          result.tokensOut,
          result.costUsd,
        );
        return true;
      });
      if (success) return;
    }
    throw new Error('Quiz usage checkpoint failed');
  }

  private async run(row: JobRow, lease: string): Promise<void> {
    let meta = read(
      (await this.prisma.quiz.findUniqueOrThrow({ where: { id: row.id } }))
        .generator,
    );
    if (meta.job.lease !== lease || meta.job.state !== 'running') return;
    const current = await this.prepare(row.userId, meta.input);
    if (
      profileLanguageScopeKey(
        current.profile.id,
        current.profile.primaryLanguageId,
        current.profile.secondaryLanguageId ?? null,
      ) !== meta.job.scopeKey ||
      snapshotHash(current.source) !== meta.sourceHash
    )
      fail('QUIZ_SOURCE_CHANGED', 'Nguồn đã thay đổi trong lúc chờ tạo đề');
    const deadline = meta.job.deadline;
    meta = await this.mutate(
      row.id,
      (m) => {
        m.job.phase = 'generate';
      },
      lease,
    );
    let callId = '';
    const before = async () => {
      await this.privacy.assertAiAllowed(row.userId);
      callId = uuidv7();
      meta = await this.mutate(
        row.id,
        (m) => {
          if (Date.now() >= deadline || m.job.calls.length >= 90)
            throw new Error('Quiz budget exhausted');
          m.job.calls.push({ id: callId, state: 'pending' });
        },
        lease,
      );
    };
    const usage = (r: AiChatResult) =>
      this.recordUsage(row.id, row.userId, meta.job.period, callId, r);
    const remaining = () => deadline - Date.now();
    const cache = (
      await recentQuizContent(
        this.prisma,
        row.userId,
        row.profileId,
        meta.input.language_id,
      )
    )
      .filter((h) => h.sourceHash === meta.sourceHash)
      .flatMap((h) => h.questions);
    // Content already checkpointed survives a worker restart or a bounded retry.
    for (
      let repair = 0;
      repair < 2 && meta.content.length < meta.input.question_count;
      repair++
    ) {
      for (
        let offset = 0;
        offset < meta.slots.length && remaining() > 1500;
        offset += 4
      ) {
        const batch = meta.slots
          .slice(offset, offset + 4)
          .filter((s) => !meta.content.some((q) => q.ordinal === s.ordinal));
        if (!batch.length) continue;
        const reused = this.engine.reuse(batch, meta.source, cache);
        const approved = [
          ...reused,
          ...(await this.engine.generate(
            batch.filter(
              (slot) => !reused.some((q) => q.ordinal === slot.ordinal),
            ),
            meta.source,
            before,
            usage,
            remaining,
          )),
        ];
        meta = await this.mutate(
          row.id,
          (m) => {
            const old = new Set(m.content.map((q) => q.ordinal));
            m.content.push(...approved.filter((q) => !old.has(q.ordinal)));
            m.audited = false;
          },
          lease,
        );
      }
    }
    // A final whole-quiz check is required for any AI skill or repeated target.
    const requiresAudit =
      meta.input.skills.some((s) => !['meaning', 'matching'].includes(s)) ||
      meta.input.skills.length > 1;
    if (
      requiresAudit &&
      meta.content.length &&
      this.engine.available() &&
      remaining() > 1500
    ) {
      meta = await this.mutate(
        row.id,
        (m) => {
          m.job.phase = 'audit';
        },
        lease,
      );
      const rejected = await this.engine.audit(
        meta.content,
        before,
        usage,
        remaining,
      );
      meta = await this.mutate(
        row.id,
        (m) => {
          m.content = m.content.filter((q) => !rejected.includes(q.ordinal));
          m.audited = true;
        },
        lease,
      );
    } else if (requiresAudit) {
      // Never expose unaudited partial content after timeout or a provider error.
      throw new Error('Quiz final audit incomplete');
    } else {
      meta = await this.mutate(
        row.id,
        (m) => {
          m.audited = true;
        },
        lease,
      );
    }
    if (meta.content.length === meta.input.question_count)
      await this.publish(row, meta, lease);
    else
      await this.mutate(
        row.id,
        (m) => {
          m.job.state = 'needs_action';
          m.job.reason = 'QUIZ_GENERATION_INCOMPLETE';
          m.job.lease = null;
        },
        lease,
      );
  }

  private async publish(
    row: JobRow,
    _meta: QuizJobMetadata,
    lease?: string,
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        await lockUser(tx, row.userId);
        const latest = await tx.quiz.findUniqueOrThrow({
          where: { id: row.id },
        });
        const m = read(latest.generator);
        if (m.job.state === 'ready') return;
        if (
          latest.expiresAt !== null &&
          latest.expiresAt.getTime() <= Date.now()
        )
          fail('QUIZ_EXPIRED', 'Đề đã hết hạn');
        if (
          lease
            ? m.job.lease !== lease || m.job.state !== 'running'
            : m.job.state !== 'needs_action'
        )
          fail('QUIZ_ACTION_NOT_ALLOWED', 'Tác vụ đã đổi trạng thái');
        if (
          !m.audited ||
          !m.content.length ||
          m.job.reason === 'QUIZ_SOURCE_CHANGED'
        )
          fail('QUIZ_ACTION_NOT_ALLOWED', 'Chưa có nội dung hợp lệ');
        const profile = await this.srs.getProfileContextInTransaction(
          tx,
          row.userId,
        );
        let unchanged =
          profileLanguageScopeKey(
            profile.id,
            profile.primaryLanguageId,
            profile.secondaryLanguageId ?? null,
          ) === m.job.scopeKey;
        // Lock all selected source items/faces and their collection rows while
        // re-reading source facts. Concurrent edits/deletes must finish first or
        // wait for this short transaction; no AI runs while locks are held.
        if (m.source.length) {
          const ids = m.source.map((item) => Prisma.sql`${item.itemId}::uuid`);
          await tx.$queryRaw(
            Prisma.sql`SELECT i.id FROM app.collection_item i JOIN app.collection c ON c.id=i.collection_id WHERE i.id IN (${Prisma.join(ids)}) AND c.owner_id=${row.userId} AND c.profile_id=${row.profileId}::uuid ORDER BY i.id FOR SHARE OF i,c`,
          );
          await tx.$queryRaw(
            Prisma.sql`SELECT f.id FROM app.collection_item_face f WHERE f.item_id IN (${Prisma.join(ids)}) ORDER BY f.id FOR SHARE`,
          );
        }
        const source = await this.sources.findSourceItems(
          {
            userId: row.userId,
            profileId: row.profileId,
            collectionId: m.input.collection_id ?? null,
            languageId: m.input.language_id,
            maxItems: 501,
            enrichKanji: true,
            withExamples: false,
          },
          tx,
        );
        unchanged &&= snapshotHash(source.slice(0, 500)) === m.sourceHash;
        const revision = m.job.revision++;
        if (!unchanged) {
          m.job.state = 'needs_action';
          m.job.reason = 'QUIZ_SOURCE_CHANGED';
          m.job.lease = null;
          m.content = [];
          m.audited = false;
          const updated = await tx.quiz.updateMany({
            where: {
              id: row.id,
              generator: { path: ['job', 'revision'], equals: revision },
            },
            data: { generator: json(m), status: 'generating' },
          });
          if (!updated.count) throw new Error('Quiz source check conflict');
          return;
        }
        const content = [...m.content].sort((a, b) => a.ordinal - b.ordinal);
        m.questions = content.map((q, i) => ({
          ordinal: i + 1,
          style: q.style,
          context: q.context,
          evidence: null,
          skill: q.skill,
          qualityFlags: q.machineGloss ? ['machine_gloss'] : [],
        }));
        m.job.state = 'ready';
        m.job.lease = null;
        const updated = await tx.quiz.updateMany({
          where: {
            id: row.id,
            generator: { path: ['job', 'revision'], equals: revision },
          },
          data: {
            status: 'ready',
            questionCount: content.length,
            generator: json(m),
          },
        });
        if (!updated.count) throw new Error('Quiz publish conflict');
        await tx.quizQuestion.createMany({
          data: content.map((q, i) => ({
            quizId: row.id,
            ordinal: i + 1,
            questionType: q.question.questionType,
            prompt: q.question.prompt,
            options: json(q.question.options),
            correctAnswer: json(q.question.correctAnswer),
            explanation: null,
            languageId: q.question.languageId,
            conceptId:
              q.question.conceptId === null
                ? null
                : BigInt(q.question.conceptId),
            itemId: q.question.itemId,
          })),
        });
      },
      { timeout: 15_000, maxWait: 10_000 },
    );
  }
}

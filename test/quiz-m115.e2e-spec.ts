import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';
import { Prisma } from '../src/generated/prisma/client';
import { fingerprint } from '../src/ai/quiz/quiz-contract';

describe('M11.5 Shared Question Bank & Synchronous Quiz E2E (PostgreSQL)', () => {
  let app: INestApplication;
  let server: Server;
  let db: PrismaService;
  let enLanguageId: number;
  let enSenses: { id: bigint; lemma: string; glossVi: string }[];
  let token1: string;
  let user1Id: bigint;
  let collection1: string;
  let u1TargetItemId: string;
  let token2: string;
  let collection2: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    server = app.getHttpServer() as Server;
    db = app.get(PrismaService);

    const langs = await db.$queryRaw<{ id: number }[]>(
      Prisma.sql`SELECT id FROM public.language WHERE code = 'en'`,
    );
    enLanguageId = Number(langs[0].id);

    enSenses = await db.$queryRaw<
      { id: bigint; lemma: string; glossVi: string }[]
    >(Prisma.sql`
      SELECT sub.id, sub.lemma, sub.gloss_vi AS "glossVi"
      FROM (
        SELECT DISTINCT ON (lower(btrim(sc.gloss_vi)))
          s.id,
          l.lemma,
          btrim(sc.gloss_vi) AS gloss_vi
        FROM core.sense s
        JOIN core.lexeme l ON l.id = s.lexeme_id
        JOIN serve.sense_card sc ON sc.sense_id = s.id
        WHERE l.language_id = ${enLanguageId}::smallint
          AND l.pos = 'noun'
          AND char_length(l.lemma) >= 3
          AND sc.gloss_vi IS NOT NULL
          AND btrim(sc.gloss_vi) <> ''
        ORDER BY lower(btrim(sc.gloss_vi)), s.id
      ) sub
      ORDER BY sub.id
      LIMIT 8
    `);
    const seenLemmas = new Set<string>();
    enSenses = enSenses.filter((row) => {
      const k = row.lemma.trim().toLowerCase();
      if (seenLemmas.has(k)) return false;
      seenLemmas.add(k);
      return true;
    });
    expect(enSenses.length).toBeGreaterThanOrEqual(4);

    // Seed 2 active variants ONLY on enSenses[0] into app.quiz_question_bank
    const target = enSenses[0];
    await db.quizQuestionBank.deleteMany({
      where: { senseId: { in: enSenses.map((s) => s.id) } },
    });
    const s1 = `Please check your ${target.lemma} before boarding.`;
    const s2 = `Keep this ${target.lemma} inside your pocket.`;
    await db.quizQuestionBank.createMany({
      data: [
        {
          senseId: target.id,
          languageId: enLanguageId,
          skill: 'context_cloze',
          variantNo: 1,
          rubricVersion: 'm11.5-v1',
          sentenceBefore: 'Please check your ',
          targetSurface: target.lemma,
          sentenceAfter: ' before boarding.',
          sentenceHash: fingerprint(s1),
          canonicalAnswer: target.lemma,
          fixedDistractors: [],
          posBucket: 'en:noun',
          excludedWords: [],
          origin: 'generated',
          verification: 'machine_reviewed',
          generatorModel: 'gemini-4-hydrogen-medium',
          validatorModel: 'muse-ai',
          status: 'active',
        },
        {
          senseId: target.id,
          languageId: enLanguageId,
          skill: 'context_cloze',
          variantNo: 2,
          rubricVersion: 'm11.5-v1',
          sentenceBefore: 'Keep this ',
          targetSurface: target.lemma,
          sentenceAfter: ' inside your pocket.',
          sentenceHash: fingerprint(s2),
          canonicalAnswer: target.lemma,
          fixedDistractors: [],
          posBucket: 'en:noun',
          excludedWords: [],
          origin: 'generated',
          verification: 'machine_reviewed',
          generatorModel: 'claude-sonnet-4-6',
          validatorModel: 'muse-ai',
          status: 'active',
        },
      ],
    });

    // User 1 setup
    const email1 = `m115-u1-${Date.now()}@langoo.test`;
    const reg1 = await request(server)
      .post('/v1/auth/register')
      .send({ email: email1, password: 'matkhau-e2e-123' })
      .expect(201);
    token1 = (reg1.body as { access_token: string }).access_token;
    const u1 = await db.user.findFirstOrThrow({ where: { email: email1 } });
    user1Id = u1.id;

    await request(server)
      .post('/v1/profiles')
      .set(auth(token1))
      .send({
        name: 'M11.5 U1 EN',
        primary_language_id: enLanguageId,
        secondary_language_id: 2,
        support_language_id: 3,
      })
      .expect(201);

    const colRes1 = await request(server)
      .post('/v1/collections')
      .set(auth(token1))
      .send({ name: 'M11.5 Deck U1' })
      .expect(201);
    collection1 = (colRes1.body as { id: string }).id;

    for (let i = 0; i < 4; i++) {
      const saved = await request(server)
        .post(`/v1/collections/${collection1}/items`)
        .set(auth(token1))
        .send({
          sense_id: enSenses[i].id.toString(),
          meaning_vi: enSenses[i].glossVi,
        })
        .expect(201);
      if (i === 0) {
        u1TargetItemId = (saved.body as { id: string }).id;
      }
    }

    // User 2 setup with same senses
    const email2 = `m115-u2-${Date.now()}@langoo.test`;
    const reg2 = await request(server)
      .post('/v1/auth/register')
      .send({ email: email2, password: 'matkhau-e2e-123' })
      .expect(201);
    token2 = (reg2.body as { access_token: string }).access_token;

    await request(server)
      .post('/v1/profiles')
      .set(auth(token2))
      .send({
        name: 'M11.5 U2 EN',
        primary_language_id: enLanguageId,
        secondary_language_id: 2,
        support_language_id: 3,
      })
      .expect(201);

    const colRes2 = await request(server)
      .post('/v1/collections')
      .set(auth(token2))
      .send({ name: 'M11.5 Deck U2' })
      .expect(201);
    collection2 = (colRes2.body as { id: string }).id;

    for (let i = 0; i < 4; i++) {
      await request(server)
        .post(`/v1/collections/${collection2}/items`)
        .set(auth(token2))
        .send({
          sense_id: enSenses[i].id.toString(),
          meaning_vi: enSenses[i].glossVi,
        })
        .expect(201);
    }
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('retires /v1/quizzes/jobs* endpoints with 404', async () => {
    await request(server)
      .post('/v1/quizzes/jobs')
      .set(auth(token1))
      .send({
        language_id: enLanguageId,
        skills: ['meaning'],
        question_count: 2,
        idempotency_key: uuidv7(),
      })
      .expect(404);
  });

  it('creates a ready quiz and reveals each answer immediately while hiding unanswered questions', async () => {
    const elig = await request(server)
      .post('/v1/quizzes/eligibility')
      .set(auth(token1))
      .send({
        collection_id: collection1,
        language_id: enLanguageId,
        skills: ['kanji_reading', 'context_cloze', 'meaning'],
        question_count: 3,
      })
      .expect(200);

    const eligBody = elig.body as {
      feasible: boolean;
      by_skill: { skill: string; source_policy: string }[];
    };
    expect(eligBody.feasible).toBe(true);
    const kanjiSkill = eligBody.by_skill.find(
      (b) => b.skill === 'kanji_reading',
    );
    expect(kanjiSkill?.source_policy).toBe('unavailable');

    const idemKey = uuidv7();
    const created = await request(server)
      .post('/v1/quizzes')
      .set(auth(token1))
      .send({
        collection_id: collection1,
        language_id: enLanguageId,
        skills: ['context_cloze', 'meaning'],
        question_count: 2,
        idempotency_key: idemKey,
      })
      .expect(201);

    expect(created.body).toMatchObject({
      status: 'ready',
      content_version: 'm11.5-v1',
      question_count: 2,
      reused: false,
    });
    const quizId = (created.body as { id: string }).id;

    // Idempotent retry returns exact same quiz
    const replayed = await request(server)
      .post('/v1/quizzes')
      .set(auth(token1))
      .send({
        collection_id: collection1,
        language_id: enLanguageId,
        skills: ['context_cloze', 'meaning'],
        question_count: 2,
        idempotency_key: idemKey,
      })
      .expect(201);
    const replayedBody = replayed.body as { id: string; reused: boolean };
    expect(replayedBody.id).toBe(quizId);
    expect(replayedBody.reused).toBe(true);

    // 0 ai_usage rows created!
    const aiUsages = await db.aiUsage.findMany({
      where: { userId: user1Id, feature: 'quiz' },
    });
    expect(aiUsages).toHaveLength(0);

    // Detail includes segments (cloze highlight === null, context === null)
    const detail = await request(server)
      .get(`/v1/quizzes/${quizId}`)
      .set(auth(token1))
      .expect(200);
    const detailBody = detail.body as {
      questions: { segments: unknown; context: unknown }[];
    };
    expect(detailBody.questions[0].segments).toEqual({
      before: 'Please check your ',
      highlight: null,
      after: ' before boarding.',
    });
    expect(detailBody.questions[0].context).toBeNull();

    // Start session (resume default)
    const started = await request(server)
      .post(`/v1/quizzes/${quizId}/start`)
      .set(auth(token1))
      .send({ intent: 'resume' })
      .expect(201);
    const startedBody = started.body as {
      session: { id: string; settings: { feedback_policy: string } };
      items: { prompt: { segments: unknown } }[];
    };
    const sessionId = startedBody.session.id;
    expect(startedBody.session.settings.feedback_policy).toBe('after_answer');
    expect(startedBody.items[0]).not.toHaveProperty('correct_answer');
    expect(startedBody.items[0].prompt.segments).toEqual({
      before: 'Please check your ',
      highlight: null,
      after: ' before boarding.',
    });

    // Resume returns same session; new_attempt while in_progress throws 409
    const resumed = await request(server)
      .post(`/v1/quizzes/${quizId}/start`)
      .set(auth(token1))
      .send({ intent: 'resume' })
      .expect(201);
    const resumedBody = resumed.body as { session: { id: string } };
    expect(resumedBody.session.id).toBe(sessionId);

    await request(server)
      .post(`/v1/quizzes/${quizId}/start`)
      .set(auth(token1))
      .send({ intent: 'new_attempt', idempotency_key: uuidv7() })
      .expect(409);

    // Grade the first question immediately and keep the second answer hidden.
    const ans1 = await request(server)
      .post(`/v1/sessions/${sessionId}/answers`)
      .set(auth(token1))
      .send({ ordinal: 1, option_index: 0 })
      .expect(200);
    const ans1Body = ans1.body as {
      session: { status: string };
      item: { is_correct: boolean | null; correct_answer?: unknown };
    };
    expect(ans1Body.session.status).toBe('in_progress');
    expect(typeof ans1Body.item.is_correct).toBe('boolean');
    expect(ans1Body.item.correct_answer).toBeDefined();
    const interim = await request(server)
      .get(`/v1/sessions/${sessionId}`)
      .set(auth(token1))
      .expect(200);
    const interimItems = (interim.body as { items: unknown[] }).items;
    expect(interimItems[0]).toMatchObject({
      is_correct: ans1Body.item.is_correct,
      correct_answer: ans1Body.item.correct_answer,
    });
    expect(interimItems[1]).not.toHaveProperty('correct_answer');
    expect(interimItems[1]).toMatchObject({ is_correct: null });

    const replay = await request(server)
      .post(`/v1/sessions/${sessionId}/answers`)
      .set(auth(token1))
      .send({ ordinal: 1, option_index: 0 })
      .expect(200);
    expect(replay.body).toEqual(ans1Body);

    const savedItem = await db.studySessionItem.findFirstOrThrow({
      where: { sessionId, ordinal: 1 },
    });
    const oldReceipt = savedItem.answerReceipt as Prisma.JsonObject;
    const oldResponse = oldReceipt.response as Prisma.JsonObject;
    const oldItem = { ...(oldResponse.item as Prisma.JsonObject) };
    delete oldItem.correct_answer;
    delete oldItem.credit;
    const oldSession = oldResponse.session as Prisma.JsonObject;
    const oldSettings = {
      ...(oldSession.settings as Prisma.JsonObject),
      feedback_policy: 'after_completion',
    };
    await db.studySession.update({
      where: { id: sessionId },
      data: { settings: oldSettings },
    });
    await db.studySessionItem.update({
      where: { id: savedItem.id },
      data: {
        answerReceipt: {
          ...oldReceipt,
          response: {
            ...oldResponse,
            item: { ...oldItem, is_correct: null, rating: null },
            session: { ...oldSession, correct_count: 0, settings: oldSettings },
          },
        },
      },
    });
    const replayOld = await request(server)
      .post(`/v1/sessions/${sessionId}/answers`)
      .set(auth(token1))
      .send({ ordinal: 1, option_index: 0 })
      .expect(200);
    expect(replayOld.body).toEqual(ans1Body);

    // Answer item 2: the item carries feedback even as the session completes.
    const ans2 = await request(server)
      .post(`/v1/sessions/${sessionId}/answers`)
      .set(auth(token1))
      .send({ ordinal: 2, option_index: 0 })
      .expect(200);
    const ans2Body = ans2.body as typeof ans1Body;
    expect(ans2Body.session.status).toBe('completed');
    expect(typeof ans2Body.item.is_correct).toBe('boolean');
    expect(ans2Body.item.correct_answer).toBeDefined();

    const finished = await request(server)
      .get(`/v1/sessions/${sessionId}`)
      .set(auth(token1))
      .expect(200);
    const finishedBody = finished.body as {
      session: { status: string };
      items: { is_correct: boolean | null }[];
    };
    expect(finishedBody.session.status).toBe('completed');
    expect(typeof finishedBody.items[0].is_correct).toBe('boolean');

    const streaks = await db.streakDay.findMany({ where: { userId: user1Id } });
    expect(streaks).toHaveLength(0);

    // Retake (new_attempt) after completion succeeds and creates a second session
    const retake = await request(server)
      .post(`/v1/quizzes/${quizId}/start`)
      .set(auth(token1))
      .send({ intent: 'new_attempt', idempotency_key: uuidv7() })
      .expect(201);
    const retakeBody = retake.body as {
      session: { id: string; status: string };
    };
    expect(retakeBody.session.id).not.toBe(sessionId);
    expect(retakeBody.session.status).toBe('in_progress');
  });

  it('rotates to variant 2 on next quiz, hides reported item for reporter 1, and quarantines globally on reporter 2', async () => {
    // User 1 creates Quiz 2 -> should automatically rotate to variant 2 ("Keep this ...")!
    const quiz2 = await request(server)
      .post('/v1/quizzes')
      .set(auth(token1))
      .send({
        collection_id: collection1,
        language_id: enLanguageId,
        skills: ['context_cloze'],
        question_count: 1,
      })
      .expect(201);
    const quiz2Id = (quiz2.body as { id: string }).id;

    const detail2 = await request(server)
      .get(`/v1/quizzes/${quiz2Id}`)
      .set(auth(token1))
      .expect(200);
    const detail2Body = detail2.body as {
      questions: { segments: unknown }[];
    };
    expect(detail2Body.questions[0].segments).toEqual({
      before: 'Keep this ',
      highlight: null,
      after: ' inside your pocket.',
    });

    // User 1 reports question 1 of quiz2 (variant 2)
    const rep1 = await request(server)
      .post(`/v1/quizzes/${quiz2Id}/questions/1/report`)
      .set(auth(token1))
      .send({
        reason: 'ambiguous',
        note: 'Câu này hơi mơ hồ',
        idempotency_key: uuidv7(),
      })
      .expect(202);
    expect(rep1.body).toMatchObject({
      status: 'recorded',
      cache_excluded: true,
    });

    // User 2 creates a quiz targeting variant 2 (first mark variant 1 as reported by User 2? Or check both variants active for User 2)
    const variant2Row = await db.quizQuestionBank.findFirstOrThrow({
      where: { senseId: enSenses[0].id, variantNo: 2 },
    });
    expect(variant2Row.status).toBe('active');
    expect(variant2Row.reportCount).toBe(1);

    // Retire variant 1 temporarily so User 2 gets variant 2 deterministically
    await db.quizQuestionBank.updateMany({
      where: { senseId: enSenses[0].id, variantNo: 1 },
      data: { status: 'retired' },
    });

    const u2Quiz = await request(server)
      .post('/v1/quizzes')
      .set(auth(token2))
      .send({
        collection_id: collection2,
        language_id: enLanguageId,
        skills: ['context_cloze'],
        question_count: 1,
      })
      .expect(201);
    const u2QuizId = (u2Quiz.body as { id: string }).id;
    const u2Detail = await request(server)
      .get(`/v1/quizzes/${u2QuizId}`)
      .set(auth(token2))
      .expect(200);
    const u2DetailBody = u2Detail.body as {
      questions: { segments: { before: string } }[];
    };
    expect(u2DetailBody.questions[0].segments.before).toBe('Keep this ');

    // User 2 ALSO reports variant 2 -> 2nd distinct reporter -> status becomes 'quarantined'!
    const rep2 = await request(server)
      .post(`/v1/quizzes/${u2QuizId}/questions/1/report`)
      .set(auth(token2))
      .send({
        reason: 'wrong_meaning',
        idempotency_key: uuidv7(),
      })
      .expect(202);
    expect(rep2.body).toMatchObject({
      status: 'quarantined',
      cache_excluded: true,
    });

    const afterQuarantine = await db.quizQuestionBank.findUniqueOrThrow({
      where: { id: variant2Row.id },
    });
    expect(afterQuarantine.status).toBe('quarantined');
    expect(afterQuarantine.reportCount).toBe(2);

    const job = await db.quizBankGenerationJob.findUnique({
      where: { senseId: enSenses[0].id },
    });
    expect(job?.status).toBe('queued');
    expect(job?.replenishCycles).toBe(1);
  });

  it('downgrades bank context_cloze to meaning when user customizes meaning_vi away from dictionary gloss', async () => {
    // Re-activate variant 1 and clear User 1 reports on it, then customize User 1 meaning_vi
    await db.quizQuestionBank.updateMany({
      where: { senseId: enSenses[0].id, variantNo: 1 },
      data: { status: 'active' },
    });
    await request(server)
      .patch(`/v1/collections/${collection1}/items/${u1TargetItemId}`)
      .set(auth(token1))
      .send({ meaning_vi: 'ghi chú nghĩa cá nhân hoàn toàn riêng biệt' })
      .expect(200);

    const customQuiz = await request(server)
      .post('/v1/quizzes')
      .set(auth(token1))
      .send({
        collection_id: collection1,
        language_id: enLanguageId,
        skills: ['context_cloze'],
        question_count: 1,
      })
      .expect(201);
    const customQuizId = (customQuiz.body as { id: string }).id;

    const customDetail = await request(server)
      .get(`/v1/quizzes/${customQuizId}`)
      .set(auth(token1))
      .expect(200);
    const customDetailBody = customDetail.body as {
      questions: { segments: unknown; context: unknown }[];
    };
    expect(customDetailBody.questions[0].segments).toBeNull();
    expect(customDetailBody.questions[0].context).toBeNull();
  });
});

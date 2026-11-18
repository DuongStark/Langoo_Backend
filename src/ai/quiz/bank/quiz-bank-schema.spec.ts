import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Prisma } from '../../../generated/prisma/client';

describe('M11.5 Quiz Question Bank Schema & Migration 050', () => {
  it('defines migration 050 with app schema tables, FKs, and partial indexes', () => {
    const sqlPath = resolve(
      __dirname,
      '../../../../db/migrations/050_quiz_question_bank.sql',
    );
    const sql = readFileSync(sqlPath, 'utf8');

    expect(sql).toMatch(/SET LOCAL lock_timeout/i);
    expect(sql).toMatch(/CREATE TABLE app\.quiz_question_bank\b/i);
    expect(sql).toMatch(/CREATE TABLE app\.quiz_question_bank_report\b/i);
    expect(sql).toMatch(/CREATE TABLE app\.quiz_bank_generation_job\b/i);
    expect(sql).toMatch(/REFERENCES core\.sense\(id\)\s+ON DELETE RESTRICT/i);
    expect(sql).toMatch(/REFERENCES app\.users\(id\)\s+ON DELETE SET NULL/i);
    expect(sql).toMatch(
      /UNIQUE\s*\(\s*sense_id,\s*skill,\s*rubric_version,\s*variant_no\s*\)/i,
    );
    expect(sql).toMatch(
      /UNIQUE\s*\(\s*bank_question_id,\s*reporter_hash\s*\)/i,
    );
    expect(sql).toMatch(/WHERE status = 'active'/i);
  });

  it('exposes Prisma scalar fields for QuizQuestionBank, QuizQuestionBankReport, and QuizBankGenerationJob', () => {
    const prismaRecord = Prisma as Record<string, unknown>;
    expect(prismaRecord.QuizQuestionBankScalarFieldEnum).toMatchObject({
      id: 'id',
      senseId: 'senseId',
      languageId: 'languageId',
      skill: 'skill',
      variantNo: 'variantNo',
      rubricVersion: 'rubricVersion',
      sentenceBefore: 'sentenceBefore',
      targetSurface: 'targetSurface',
      sentenceAfter: 'sentenceAfter',
      sentenceHash: 'sentenceHash',
      canonicalAnswer: 'canonicalAnswer',
      fixedDistractors: 'fixedDistractors',
      posBucket: 'posBucket',
      excludedWords: 'excludedWords',
      status: 'status',
      reportCount: 'reportCount',
    });

    expect(prismaRecord.QuizQuestionBankReportScalarFieldEnum).toMatchObject({
      id: 'id',
      bankQuestionId: 'bankQuestionId',
      userId: 'userId',
      reporterHash: 'reporterHash',
      reason: 'reason',
      idempotencyKey: 'idempotencyKey',
      status: 'status',
    });

    expect(prismaRecord.QuizBankGenerationJobScalarFieldEnum).toMatchObject({
      senseId: 'senseId',
      languageId: 'languageId',
      status: 'status',
      priority: 'priority',
      attempts: 'attempts',
      replenishCycles: 'replenishCycles',
    });
  });
});

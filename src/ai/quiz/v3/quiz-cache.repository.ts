import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../db/prisma.service';
import { ValidatedQuestion } from './quiz-batch-engine';
import { QUIZ_V3 } from './quiz-blueprint';

/** Project only approved content, never reload eight full source snapshots. */
export async function recentQuizContent(
  prisma: PrismaService,
  userId: bigint,
  profileId: string,
  languageId: number,
): Promise<{ sourceHash: string; questions: ValidatedQuestion[] }[]> {
  const rows = await prisma.$queryRaw<
    { source_hash: string; content: unknown; blocked_keys: string[] }[]
  >(Prisma.sql`
    SELECT generator->>'sourceHash' AS source_hash, generator->'content' AS content,
      ARRAY(SELECT DISTINCT report->>'cacheKey'
        FROM app.quiz flagged
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(flagged.generator->'reports','[]'::jsonb)) report
        WHERE flagged.user_id=${userId} AND flagged.profile_id=${profileId}::uuid
          AND flagged.generator->'input'->>'language_id'=${String(languageId)}
          AND report->>'status'='pending') AS blocked_keys
    FROM app.quiz
    WHERE user_id=${userId} AND profile_id=${profileId}::uuid AND status='ready'
      AND (expires_at IS NULL OR expires_at>now())
      AND generator->>'version'=${QUIZ_V3}
      AND generator->'input'->>'language_id'=${String(languageId)}
    ORDER BY created_at DESC, id DESC LIMIT 8
  `);
  return rows.flatMap((row) =>
    Array.isArray(row.content) && row.content.every(isValidatedQuestion)
      ? [
          {
            sourceHash: row.source_hash,
            questions: row.content.filter(
              (q) => !row.blocked_keys.includes(q.cacheKey),
            ),
          },
        ]
      : [],
  );
}

export function isValidatedQuestion(
  value: unknown,
): value is ValidatedQuestion {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('cacheKey' in value) ||
    typeof value.cacheKey !== 'string' ||
    !('ordinal' in value) ||
    !Number.isInteger(value.ordinal) ||
    !('skill' in value) ||
    typeof value.skill !== 'string' ||
    !('targets' in value) ||
    !Array.isArray(value.targets) ||
    !('question' in value)
  )
    return false;
  const q = value.question;
  return (
    typeof q === 'object' &&
    q !== null &&
    'prompt' in q &&
    typeof q.prompt === 'string' &&
    'options' in q &&
    Array.isArray(q.options) &&
    'correctAnswer' in q &&
    typeof q.correctAnswer === 'object' &&
    q.correctAnswer !== null
  );
}

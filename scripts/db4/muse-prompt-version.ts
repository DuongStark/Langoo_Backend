export type PromptRevision = 'v1' | 'v2' | 'v2.1';
export type PromptPhase = 'r1' | 'r2';
export type PromptAttempt = 'base' | 'repair1';

const PROMPT_PREFIX = 'db4-d4-semantic-match';
const PROMPT_REVISION_RE =
  /^db4-d4-semantic-match-(v1|v2|v2\.1)-(r1|r2)(-repair1)?$/;

export function parsePromptRevision(value: string): PromptRevision {
  if (value === 'v1' || value === 'v2' || value === 'v2.1') return value;
  throw new Error('Prompt revision must be v1, v2, or v2.1');
}

export function promptBase(revision: PromptRevision): string {
  return `${PROMPT_PREFIX}-${revision}`;
}

export function promptFilename(
  revision: PromptRevision,
  part: PromptPhase | 'system',
): string {
  return `${promptBase(revision)}.${part}.txt`;
}

export function promptVersion(
  revision: PromptRevision,
  phase: PromptPhase,
  attempt: PromptAttempt = 'base',
): string {
  const suffix = attempt === 'repair1' ? '-repair1' : '';
  return `${promptBase(revision)}-${phase}${suffix}`;
}

export function promptRevisionFromVersions(versions: {
  r1: string;
  r2: string;
}): { revision: PromptRevision; attempt: PromptAttempt } {
  const parse = (value: string) => {
    const match = PROMPT_REVISION_RE.exec(value);
    if (!match) throw new Error(`Unsupported DB4 prompt version: ${value}`);
    return {
      revision: parsePromptRevision(match[1]),
      phase: match[2] as PromptPhase,
      attempt: match[3] ? ('repair1' as const) : ('base' as const),
    };
  };
  const r1 = parse(versions.r1);
  const r2 = parse(versions.r2);
  if (
    r1.phase !== 'r1' ||
    r2.phase !== 'r2' ||
    r1.revision !== r2.revision ||
    r1.attempt !== r2.attempt
  )
    throw new Error('DB4 prompt versions must bind matching R1/R2 revisions');
  return { revision: r1.revision, attempt: r1.attempt };
}

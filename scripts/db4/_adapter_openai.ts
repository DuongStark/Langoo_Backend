import type { MappingProvider } from './_mapping-types';
import type { ProviderAdapter, ProviderAdapterRequest } from './_runner';

/**
 * Adapter OpenAI-compatible chat-completions (dùng cho longcat free qua
 * `https://opencode.ai/zen/go/v1/chat/completions` + header `x-opencode-session`).
 *
 * - Prompt dựng deterministic từ `rendered.payload` (bundle đã sort theo phase/seed).
 * - Output phải là DUY NHẤT một JSON object; runner vẫn validate bằng `parseMappingOutput`.
 * - API key chỉ nhận từ env (CLI truyền vào), KHÔNG ghi vào job/artifact.
 */

export interface ChatCompletionsConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  sessionId: string;
  maxTokens: number;
  timeoutMs?: number;
  temperature?: number;
  /** Param phụ (vd reasoning_effort) — merge vào body request. */
  extraBody?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}

export interface ChatCompletionResult {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: string | null;
}

const PHASE_GUIDANCE: Record<'r1' | 'r2', string> = {
  r1: 'This is pass R1: judge each candidate concept against the sense glosses/definitions on its own merits.',
  r2: 'This is pass R2: adversarially re-check the mapping. Start from the assumption that a link is NOT exact unless gloss scope and concept scope are identical in both directions; test every "exact" hypothesis against the concept definition before keeping it.',
};

export function buildReviewPrompt(request: ProviderAdapterRequest): {
  system: string;
  user: string;
} {
  const bundle = request.rendered.payload.bundle;
  const candidateCount = bundle.candidates.length;
  const system = [
    'You are a lexicographic mapping reviewer for a Japanese dictionary (JMdict senses -> WordNet/Open Multilingual WordNet concepts).',
    PHASE_GUIDANCE[request.phase],
    'Output ONLY one JSON object, no markdown fences, no commentary. Shape:',
    '{"schemaVersion":1,"task":"sense_concept_review","bundleKey":"<echo input bundleKey>","senseId":"<echo input senseId>","contextHash":"<echo input contextHash>","reviews":[{"candidateKey":"<echo candidateKey>","conceptId":"<echo conceptId>","relation":"exact|broader|narrower|related|none|uncertain","coveredBranches":["<branch key>"],"missingBranches":["<branch key>"],"conflicts":[],"reason":"short justification","confidence":null}],"noSuitableCandidate":false,"unresolvedReason":null}',
    'Hard rules:',
    `- Output exactly ${candidateCount} review entries, one per input candidate, in the same order as the input candidates array; candidateKey and conceptId MUST be copied exactly (never invent, never skip).`,
    '- coveredBranches + missingBranches must partition ALL input sourceBranches keys: every sourceBranches key appears exactly once across the two arrays.',
    '- relation meanings: exact = identical meaning scope both directions; broader = the sense is broader than the concept; narrower = the sense is narrower than the concept; related = associated but not equivalent; none = wrong concept; uncertain = not enough evidence.',
    '- "exact" requires coveredBranches = all sourceBranches, missingBranches = [], and conflicts = [].',
    '- "noSuitableCandidate" must be true exactly when every review relation is "none".',
    '- unresolvedReason must be a non-null object {"code":"missing_context","detail":"..."} (allowed codes: missing_context, missing_identity, ambiguous_concepts, review_disagreement) when any relation is "uncertain" OR more than one candidate is "exact"; otherwise null.',
    '- "conflicts" MUST always be [] in this task. Do not use any other conflict code.',
    '- reason <= 400 characters, write it in English.',
    '- Do not output anything except the JSON object.',
  ].join('\n');
  const view = {
    schemaVersion: 1,
    family: 'db4-review-input-v1',
    phase: request.phase,
    seed: request.rendered.payload.seed,
    promptVersion: request.rendered.payload.promptVersion,
    bundleKey: bundle.bundleKey,
    contextHash: bundle.contextHash,
    senseId: bundle.sense.id,
    sense: {
      language: bundle.sense.language,
      lemma: bundle.sense.lemma,
      reading: bundle.sense.reading,
      forms: bundle.sense.forms,
      senseNo: bundle.sense.senseNo,
      isPrimary: bundle.sense.isPrimary,
      jlptLevel: bundle.sense.jlptLevel,
      normalizedPos: bundle.senseContext.metadata.normalizedPos,
      rawPos: bundle.senseContext.metadata.rawPos,
    },
    sourceBranches: bundle.sourceBranches,
    glosses: bundle.senseContext.enGlosses.map((row) => ({
      key: row.key,
      text: row.text,
    })),
    definitions: bundle.senseContext.definitions.map((row) => ({
      key: row.key,
      text: row.text,
    })),
    candidates: bundle.candidates.map((candidate) => ({
      candidateKey: candidate.candidateKey,
      conceptId: candidate.concept.id,
      conceptPos: candidate.concept.pos,
      conceptIli: candidate.concept.ili,
      conceptDefinitions: candidate.conceptContext.definitions.map(
        (row) => row.text,
      ),
      conceptLabels: candidate.conceptContext.labels.map((row) => row.text),
    })),
  };
  return {
    system,
    user: JSON.stringify(view),
  };
}

export function extractJsonObject(content: string): unknown {
  const trimmed = content.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start < 0 || end <= start)
    throw new Error(`Output không chứa JSON object: ${trimmed.slice(0, 160)}`);
  return JSON.parse(unfenced.slice(start, end + 1)) as unknown;
}

export async function callChatCompletion(
  config: ChatCompletionsConfig,
  body: {
    messages: { role: 'system' | 'user'; content: string }[];
    maxTokens: number;
    temperature?: number;
  },
): Promise<ChatCompletionResult> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, config.timeoutMs ?? 240_000);
  try {
    const response = await fetchImpl(config.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'x-opencode-session': config.sessionId,
      },
      body: JSON.stringify({
        ...(config.extraBody ?? {}),
        model: config.model,
        max_tokens: body.maxTokens,
        temperature: body.temperature ?? 0,
        messages: body.messages,
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok)
      throw new Error(
        `HTTP ${response.status} ${response.statusText}: ${text.slice(0, 300)}`,
      );
    const parsed = JSON.parse(text) as {
      choices?: {
        finish_reason?: string | null;
        message?: { content?: unknown };
      }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };
    const choice = parsed.choices?.[0];
    const content = choice?.message?.content;
    if (typeof content !== 'string' || !content.trim())
      throw new Error(
        `Response thiếu content (finish ${String(choice?.finish_reason)}): ${text.slice(0, 200)}`,
      );
    const usage = {
      promptTokens: parsed.usage?.prompt_tokens ?? 0,
      completionTokens: parsed.usage?.completion_tokens ?? 0,
      totalTokens: parsed.usage?.total_tokens ?? 0,
    };
    return {
      content,
      usage,
      finishReason: choice?.finish_reason ?? null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function createChatCompletionsAdapter(
  config: ChatCompletionsConfig,
): ProviderAdapter {
  return {
    id: `${config.model}@${new URL(config.endpoint).host}`,
    review: async (request) => {
      const { system, user } = buildReviewPrompt(request);
      const result = await callChatCompletion(
        {
          ...config,
          sessionId: request.provider.sessionId || config.sessionId,
        },
        {
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          maxTokens: config.maxTokens,
        },
      );
      if (result.finishReason === 'length')
        throw new Error(
          'Output bị cắt (finish_reason=length) — tăng max_tokens hoặc rút gọn bundle',
        );
      const raw = extractJsonObject(result.content);
      return {
        raw,
        usage: {
          tokens: result.usage.totalTokens,
          costMicrousd: 0,
        },
      };
    },
  };
}

export function providerSlug(provider: MappingProvider): string {
  return `${provider.provider}-${provider.model}`
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-');
}

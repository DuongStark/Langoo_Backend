import { Injectable } from '@nestjs/common';
import {
  AiChatDeltaHandler,
  AiChatProvider,
  AiChatRequest,
  AiChatResult,
  AiProviderError,
  estimateTokens,
} from './ai-chat.provider';

export interface OpenAiChatProviderOptions {
  /** Base URL kiểu OpenAI, ví dụ https://api.openai.com/v1 hoặc gateway nội bộ. */
  baseUrl: string;
  apiKey: string;
}

interface OpenAiMessageContent {
  content?: unknown;
}

interface OpenAiChatCompletionResponse {
  model?: unknown;
  choices?: { message?: OpenAiMessageContent }[];
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
}

interface OpenAiStreamChunk {
  model?: unknown;
  choices?: { delta?: { content?: unknown } }[];
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
}

/**
 * Adapter OpenAI-compatible (chat/completions) — dùng được với OpenAI, Groq,
 * OpenCode Zen (`https://opencode.ai/zen/v1`) hoặc proxy nội bộ, không thêm dependency.
 * Hỗ trợ streaming SSE cho endpoint chat dạng `stream: true`.
 */
@Injectable()
export class OpenAiChatProvider implements AiChatProvider {
  readonly name = 'openai';
  private readonly baseUrl: string;

  constructor(private readonly options: OpenAiChatProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
  }

  async chat(request: AiChatRequest): Promise<AiChatResult> {
    const { signal, cleanup } = withTimeout(request.timeoutMs, request.signal);
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(this.body(request)),
        signal,
      });

      if (!response.ok) {
        throw await httpError(response);
      }

      const payload = (await response.json()) as OpenAiChatCompletionResponse;
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.trim() === '') {
        throw new AiProviderError('provider trả về nội dung rỗng');
      }

      return this.toResult(payload, request, content);
    } finally {
      cleanup();
    }
  }

  async chatStream(
    request: AiChatRequest,
    onDelta: AiChatDeltaHandler,
  ): Promise<AiChatResult> {
    const { signal, cleanup } = withTimeout(request.timeoutMs, request.signal);
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          ...this.body(request),
          stream: true,
          ...(request.messages.some((m) => m.images?.length)
            ? { stream_options: { include_usage: true } }
            : {}),
        }),
        signal,
      });

      if (!response.ok) {
        throw await httpError(response);
      }
      if (!response.body) {
        throw new AiProviderError('provider không trả về stream');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let content = '';
      let model = request.model;
      let usage: OpenAiStreamChunk['usage'];

      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          const rawLine = buffer.slice(0, newline).replace(/\r$/, '');
          buffer = buffer.slice(newline + 1);
          const delta = this.consumeSseLine(rawLine, onDelta);
          if (delta.content !== '') {
            content += delta.content;
          }
          if (delta.model !== undefined) {
            model = delta.model;
          }
          if (delta.usage !== undefined) {
            usage = delta.usage;
          }
          newline = buffer.indexOf('\n');
        }
      }

      if (content.trim() === '') {
        // Model reasoning có thể "đốt" hết token vào phần suy nghĩ mà không trả
        // nội dung — coi là lỗi để service báo bận thay vì lưu tin rỗng.
        throw new AiProviderError('provider trả về nội dung rỗng');
      }

      return {
        content,
        model,
        tokensIn:
          typeof usage?.prompt_tokens === 'number' && usage.prompt_tokens >= 0
            ? usage.prompt_tokens
            : estimateRequestTokens(request),
        tokensOut:
          typeof usage?.completion_tokens === 'number' &&
          usage.completion_tokens >= 0
            ? usage.completion_tokens
            : estimateTokens(content),
        costUsd: 0,
      };
    } finally {
      cleanup();
    }
  }

  private consumeSseLine(
    line: string,
    onDelta: AiChatDeltaHandler,
  ): { content: string; model?: string; usage?: OpenAiStreamChunk['usage'] } {
    if (!line.startsWith('data:')) {
      return { content: '' };
    }
    const data = line.slice(5).trim();
    if (data === '' || data === '[DONE]') {
      return { content: '' };
    }
    let chunk: OpenAiStreamChunk;
    try {
      chunk = JSON.parse(data) as OpenAiStreamChunk;
    } catch {
      return { content: '' };
    }
    const delta = chunk.choices?.[0]?.delta?.content;
    const text = typeof delta === 'string' ? delta : '';
    if (text !== '') {
      onDelta(text);
    }
    return {
      content: text,
      model: typeof chunk.model === 'string' ? chunk.model : undefined,
      usage: chunk.usage,
    };
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${this.options.apiKey}`,
    };
  }

  private body(request: AiChatRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.map(({ images, ...message }) =>
        images?.length
          ? {
              ...message,
              content: [
                { type: 'text', text: message.content },
                ...images.map((url) => ({
                  type: 'image_url',
                  image_url: { url },
                })),
              ],
            }
          : message,
      ),
    };
    if (request.maxTokens !== undefined) {
      body.max_tokens = request.maxTokens;
    }
    if (request.reasoningEffort !== undefined) {
      body.reasoning_effort = request.reasoningEffort;
    }
    return body;
  }

  private toResult(
    payload: OpenAiChatCompletionResponse,
    request: AiChatRequest,
    content: string,
  ): AiChatResult {
    const promptTokens = payload.usage?.prompt_tokens;
    const completionTokens = payload.usage?.completion_tokens;
    return {
      content,
      model:
        typeof payload.model === 'string' && payload.model !== ''
          ? payload.model
          : request.model,
      tokensIn:
        typeof promptTokens === 'number' && promptTokens >= 0
          ? promptTokens
          : estimateRequestTokens(request),
      tokensOut:
        typeof completionTokens === 'number' && completionTokens >= 0
          ? completionTokens
          : estimateTokens(content),
      costUsd: 0,
      ...(typeof promptTokens !== 'number' ||
      typeof completionTokens !== 'number' ||
      promptTokens < 0 ||
      completionTokens < 0
        ? { usageEstimated: true }
        : {}),
    };
  }
}

async function httpError(response: Response): Promise<AiProviderError> {
  // Upstream error bodies may echo private text/images. Never retain/log them.
  await response.body?.cancel();
  return new AiProviderError(
    `provider HTTP ${response.status}`,
    response.status,
  );
}

/**
 * Gộp timeout nội bộ với tín hiệu hủy từ client (nếu có).
 * Trả cleanup để clear timer và remove listener.
 */
function withTimeout(
  timeoutMs: number,
  external?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error('provider timeout'));
  }, timeoutMs);
  const onAbort = (): void => {
    controller.abort(external?.reason);
  };
  if (external) {
    if (external.aborted) {
      controller.abort(external.reason);
    } else {
      external.addEventListener('abort', onAbort, { once: true });
    }
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      external?.removeEventListener('abort', onAbort);
    },
  };
}

/** Qwen/Groq fallback only; real provider usage takes precedence. No base64 counting. */
function estimateRequestTokens(request: AiChatRequest): number {
  const textTokens = estimateTokens(
    request.messages.map((m) => m.content).join('\n'),
  );
  const imageCount = request.messages.reduce(
    (sum, m) => sum + (m.images?.length ?? 0),
    0,
  );
  return textTokens + imageCount * 2048;
}

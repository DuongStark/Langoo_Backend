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
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
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

      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let skipLf = false;
      let dataLines: string[] = [];
      let completed = false;
      let content = '';
      let model = request.model;
      let usage: OpenAiStreamChunk['usage'];

      const consumeLines = (): void => {
        if (skipLf && buffer.length > 0) {
          if (buffer.startsWith('\n')) buffer = buffer.slice(1);
          skipLf = false;
        }
        let newline = buffer.search(/[\r\n]/);
        while (newline >= 0) {
          const rawLine = buffer.slice(0, newline);
          const width =
            buffer[newline] === '\r' && buffer[newline + 1] === '\n' ? 2 : 1;
          // Dispatch CR immediately; skip its LF if that byte arrives later.
          skipLf =
            width === 1 &&
            buffer[newline] === '\r' &&
            newline + width === buffer.length;
          buffer = buffer.slice(newline + width);
          if (rawLine === '') {
            const delta = this.consumeSseEvent(dataLines.join('\n'), onDelta);
            dataLines = [];
            content += delta.content;
            model = delta.model ?? model;
            usage = delta.usage ?? usage;
            if (delta.done) {
              completed = true;
              return;
            }
          } else if (rawLine === 'data' || rawLine.startsWith('data:')) {
            dataLines.push(rawLine.slice(5).replace(/^ /, ''));
          }
          newline = buffer.search(/[\r\n]/);
        }
      };

      while (!completed) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        signal.throwIfAborted();
        buffer += done
          ? decoder.decode()
          : decoder.decode(value, { stream: true });
        consumeLines();
        if (done) break;
      }

      if (!completed) {
        // EOF is not evidence of a completed answer, even if some text arrived.
        throw new AiProviderError('provider stream kết thúc trước [DONE]');
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
          validTokenCount(usage?.prompt_tokens) ??
          estimateRequestTokens(request),
        tokensOut:
          validTokenCount(usage?.completion_tokens) ?? estimateTokens(content),
        costUsd: 0,
      };
    } finally {
      cleanup();
      if (reader) {
        try {
          await reader.cancel();
        } catch {
          // Preserve the original protocol/abort error.
        } finally {
          reader.releaseLock();
        }
      }
    }
  }

  private consumeSseEvent(
    data: string,
    onDelta: AiChatDeltaHandler,
  ): {
    content: string;
    done?: boolean;
    model?: string;
    usage?: OpenAiStreamChunk['usage'];
  } {
    if (data.trim() === '[DONE]') return { content: '', done: true };
    if (data.trim() === '') {
      return { content: '' };
    }
    let payload: unknown;
    try {
      payload = JSON.parse(data) as unknown;
    } catch {
      throw new AiProviderError('provider trả về SSE không hợp lệ');
    }
    if (
      !isRecord(payload) ||
      'error' in payload ||
      (!Array.isArray(payload.choices) &&
        !(payload.choices === undefined && isRecord(payload.usage)))
    ) {
      throw new AiProviderError('provider trả về SSE không hợp lệ');
    }
    const chunk = payload as OpenAiStreamChunk;
    const choice = chunk.choices?.[0];
    if (
      choice !== undefined &&
      (!isRecord(choice) || !isRecord(choice.delta))
    ) {
      throw new AiProviderError('provider trả về delta không hợp lệ');
    }
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta !== undefined && delta !== null && typeof delta !== 'string') {
      throw new AiProviderError('provider trả về delta không hợp lệ');
    }
    const text = typeof delta === 'string' ? delta : '';
    if (text !== '') {
      onDelta(text);
    }
    return {
      content: text,
      model:
        typeof chunk.model === 'string' && chunk.model.trim() !== ''
          ? chunk.model
          : undefined,
      usage: isRecord(chunk.usage) ? chunk.usage : undefined,
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
      tokensIn: validTokenCount(promptTokens) ?? estimateRequestTokens(request),
      tokensOut: validTokenCount(completionTokens) ?? estimateTokens(content),
      costUsd: 0,
      ...(validTokenCount(promptTokens) === undefined ||
      validTokenCount(completionTokens) === undefined
        ? { usageEstimated: true }
        : {}),
    };
  }
}

async function httpError(response: Response): Promise<AiProviderError> {
  // Upstream error bodies can echo credentials or prompts. Keep only status.
  await response.body?.cancel().catch(() => undefined);
  return new AiProviderError(
    `provider HTTP ${response.status}`,
    response.status,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validTokenCount(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 2_147_483_647
    ? value
    : undefined;
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
    controller.abort(new DOMException('provider timeout', 'TimeoutError'));
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

import { Injectable } from '@nestjs/common';
import {
  AiChatProvider,
  AiChatRequest,
  AiChatResult,
  estimateTokens,
} from './ai-chat.provider';

export interface OpenAiChatProviderOptions {
  /** Base URL kiểu OpenAI, ví dụ https://api.openai.com/v1 hoặc https://opencode.ai/zen/v1 */
  baseUrl: string;
  apiKey: string;
}

interface OpenAiChatCompletionResponse {
  model?: unknown;
  choices?: { message?: { content?: unknown } }[];
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
}

/**
 * Adapter OpenAI-compatible (chat/completions) — dùng được với OpenAI, gateway
 * OpenCode Zen (`https://opencode.ai/zen/v1`) hoặc proxy nội bộ, không thêm dependency.
 */
@Injectable()
export class OpenAiChatProvider implements AiChatProvider {
  readonly name = 'openai';
  private readonly baseUrl: string;

  constructor(private readonly options: OpenAiChatProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
  }

  async chat(request: AiChatRequest): Promise<AiChatResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = (await response.text()).slice(0, 200);
        throw new Error(`provider HTTP ${response.status}: ${detail}`);
      }

      const payload = (await response.json()) as OpenAiChatCompletionResponse;
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.trim() === '') {
        throw new Error('provider trả về nội dung rỗng');
      }

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
            : estimateTokens(request.messages.map((m) => m.content).join('\n')),
        tokensOut:
          typeof completionTokens === 'number' && completionTokens >= 0
            ? completionTokens
            : estimateTokens(content),
        costUsd: 0,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

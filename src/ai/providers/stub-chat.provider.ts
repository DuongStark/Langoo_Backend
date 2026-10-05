import { Injectable } from '@nestjs/common';
import {
  AiChatDeltaHandler,
  AiChatProvider,
  AiChatRequest,
  AiChatResult,
  estimateTokens,
} from './ai-chat.provider';

const MAX_ECHO_LENGTH = 200;
const STREAM_CHUNK_SIZE = 18;

/**
 * Provider giả chạy không cần key/mạng — deterministic để e2e assert.
 * Trả lời template, có ngữ cảnh sense khi client hỏi về một từ cụ thể.
 */
@Injectable()
export class StubChatProvider implements AiChatProvider {
  readonly name = 'stub';

  chat(request: AiChatRequest): Promise<AiChatResult> {
    return Promise.resolve(this.buildResult(request));
  }

  /** Phát nội dung theo từng đoạn nhỏ để e2e kiểm tra SSE mà không cần mạng. */
  async chatStream(
    request: AiChatRequest,
    onDelta: AiChatDeltaHandler,
  ): Promise<AiChatResult> {
    const result = this.buildResult(request);
    for (
      let index = 0;
      index < result.content.length;
      index += STREAM_CHUNK_SIZE
    ) {
      onDelta(result.content.slice(index, index + STREAM_CHUNK_SIZE));
      await Promise.resolve();
    }
    return result;
  }

  private buildResult(request: AiChatRequest): AiChatResult {
    const lastUser =
      [...request.messages].reverse().find((m) => m.role === 'user')?.content ??
      '';

    const lines: string[] = [];
    const sense = request.senseContext;
    if (sense) {
      const reading = sense.reading ? ` (${sense.reading})` : '';
      const gloss = sense.glossVi ?? sense.glossEn ?? 'chưa có gloss';
      const badge = sense.glossViMachine ? ' [gloss máy, chưa duyệt]' : '';
      lines.push(`[stub] ${sense.lemma}${reading}: ${gloss}${badge}`);
      if (sense.example) {
        lines.push(`Ví dụ: ${sense.example.text}`);
        if (sense.example.translationVi) {
          lines.push(`Dịch: ${sense.example.translationVi}`);
        }
      }
    } else {
      lines.push(
        '[stub] Mình đang chạy chế độ demo (chưa cấu hình AI provider thật).',
      );
      lines.push(`Bạn vừa hỏi: "${truncate(lastUser)}"`);
    }
    lines.push(
      'Đặt AI_PROVIDER + AI_API_KEY + AI_CHAT_MODEL (và AI_BASE_URL nếu dùng gateway) để bật trả lời thật.',
    );

    const content = lines.join('\n');
    const tokensIn = estimateTokens(
      request.messages.map((m) => m.content).join('\n'),
    );
    return {
      content,
      model: request.model,
      tokensIn,
      tokensOut: estimateTokens(content),
      costUsd: 0,
    };
  }
}

function truncate(value: string): string {
  const trimmed = value.trim();
  return trimmed.length <= MAX_ECHO_LENGTH
    ? trimmed
    : `${trimmed.slice(0, MAX_ECHO_LENGTH)}…`;
}

/** Token DI cho provider AI (đổi implementation theo env, không đổi service). */
export const AI_CHAT_PROVIDER = 'AI_CHAT_PROVIDER';

export type AiChatRole = 'system' | 'user' | 'assistant';

export interface AiChatMessage {
  role: AiChatRole;
  content: string;
}

/** Ngữ cảnh nghĩa (từ điển) đính kèm khi client gửi `ref_sense_id`. */
export interface AiSenseContext {
  senseId: string;
  lemma: string;
  reading: string | null;
  pos: string | null;
  glossVi: string | null;
  glossEn: string | null;
  /** true nếu gloss vi do máy sinh và chưa được duyệt. */
  glossViMachine: boolean;
  example: { text: string; translationVi: string | null } | null;
}

export interface AiChatRequest {
  messages: AiChatMessage[];
  model: string;
  timeoutMs: number;
  /** Provider thật không cần (đã nằm trong messages); stub dùng để trả lời demo. */
  senseContext?: AiSenseContext | null;
  /** Giới hạn token trả lời — chỉ gửi khi được cấu hình. */
  maxTokens?: number;
  /** Mức suy luận cho model reasoning (reasoning_effort, chỉ gửi khi cấu hình). */
  reasoningEffort?: string;
  /** Huỷ khi client ngắt kết nối. */
  signal?: AbortSignal;
}

export interface AiChatResult {
  content: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  /** 0 khi chưa có bảng giá token (backlog M13). */
  costUsd: number;
}

export type AiChatDeltaHandler = (delta: string) => void;

export interface AiChatProvider {
  readonly name: string;
  chat(request: AiChatRequest): Promise<AiChatResult>;
  /** Trả lời dần từng đoạn (SSE). Optional — service tự fallback về `chat()`. */
  chatStream?(
    request: AiChatRequest,
    onDelta: AiChatDeltaHandler,
  ): Promise<AiChatResult>;
}

/** Lỗi từ provider kèm HTTP status để service quyết định retry. */
export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }

  /** 429 và lỗi 5xx là lỗi tạm thời — có thể thử lại một lần. */
  get retryable(): boolean {
    return (
      this.status === 429 || (this.status !== undefined && this.status >= 500)
    );
  }
}

/** Ước lượng token khi provider không trả usage (≈ 4 ký tự/token). */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** True nếu lỗi là do abort (timeout của mình hoặc client ngắt). */
export function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}

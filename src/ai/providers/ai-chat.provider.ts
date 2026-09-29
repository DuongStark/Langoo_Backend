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
}

export interface AiChatResult {
  content: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  /** 0 khi chưa có bảng giá token (backlog M13). */
  costUsd: number;
}

export interface AiChatProvider {
  readonly name: string;
  chat(request: AiChatRequest): Promise<AiChatResult>;
}

/** Ước lượng token khi provider không trả usage (≈ 4 ký tự/token). */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

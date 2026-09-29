export interface ChatSessionResponse {
  id: string;
  language_id: number;
  scenario: string | null;
  title: string | null;
  model: string | null;
  prompt_version: string | null;
  message_count: number;
  last_message_at: string | null;
  created_at: string;
  archived_at: string | null;
}

export interface ChatMessageResponse {
  id: string;
  session_id: string;
  role: string;
  content: string;
  ref_sense_id: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: string | null;
  model: string | null;
  created_at: string;
}

export interface ChatSessionListResponse {
  data: ChatSessionResponse[];
  next_cursor: string | null;
}

export interface ChatMessageListResponse {
  data: ChatMessageResponse[];
  next_cursor: string | null;
}

export interface SendChatMessageResponse {
  user_message: ChatMessageResponse;
  assistant_message: ChatMessageResponse;
  usage: { request_count: number; limit: number };
}

export interface ChatUsageResponse {
  feature: 'chat';
  period: string;
  request_count: number;
  limit: number;
}

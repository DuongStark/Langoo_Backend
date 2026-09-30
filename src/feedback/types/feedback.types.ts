export interface FeedbackAttachmentResponse {
  id: string;
  mime: string;
  size_bytes: number;
}

export interface FeedbackResponse {
  id: string;
  category: string;
  content: string;
  status: string;
  admin_note: string | null;
  attachments: FeedbackAttachmentResponse[];
  created_at: string;
  updated_at: string;
}

export interface AdminFeedbackResponse extends FeedbackResponse {
  user: { id: string; email: string };
}

export interface FeedbackListResponse<T> {
  data: T[];
  next_cursor: string | null;
}

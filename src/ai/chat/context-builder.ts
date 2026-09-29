import { AiChatMessage, AiSenseContext } from '../providers/ai-chat.provider';

export const CHAT_SCENARIOS = [
  'general',
  'vocabulary',
  'grammar',
  'conversation',
] as const;
export type ChatScenario = (typeof CHAT_SCENARIOS)[number];

/** Số tin gần nhất gửi kèm cho provider (không tính system). */
export const CHAT_HISTORY_LIMIT = 20;
export const CHAT_PROMPT_VERSION = 'm10-v1';

export interface ChatContextInput {
  scenario: ChatScenario;
  /** Mã ngôn ngữ đích của phiên ('ja', 'en'…). */
  targetLanguage: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  senseContext?: AiSenseContext | null;
}

/**
 * Dựng messages gửi provider: system prompt theo scenario + (tuỳ chọn) block
 * ngữ cảnh sense + N tin gần nhất theo thứ tự thời gian tăng dần.
 * Hàm thuần — unit test kiểm soát được nội dung.
 */
export function buildChatMessages(input: ChatContextInput): AiChatMessage[] {
  const messages: AiChatMessage[] = [
    {
      role: 'system',
      content: systemPrompt(input.scenario, input.targetLanguage),
    },
  ];

  if (input.senseContext) {
    messages.push({ role: 'system', content: senseBlock(input.senseContext) });
  }

  for (const item of input.history.slice(-CHAT_HISTORY_LIMIT)) {
    messages.push({ role: item.role, content: item.content });
  }
  return messages;
}

function systemPrompt(scenario: ChatScenario, targetLanguage: string): string {
  const language = languageName(targetLanguage);
  const common =
    `Bạn là trợ lý học ngoại ngữ của ứng dụng Langoo, hỗ trợ người Việt học ${language}. ` +
    'Trả lời bằng tiếng Việt, ngắn gọn, thân thiện; chèn ví dụ trong ngôn ngữ đích khi hữu ích.';

  switch (scenario) {
    case 'vocabulary':
      return (
        common +
        ' Người dùng đang hỏi về từ vựng: giải thích nghĩa, cách dùng, phân biệt các nghĩa và cho ví dụ.'
      );
    case 'grammar':
      return (
        common +
        ' Người dùng đang hỏi ngữ pháp: giải thích cấu trúc, cách chia, lỗi thường gặp và ví dụ đúng/sai.'
      );
    case 'conversation':
      return (
        common +
        ` Người dùng muốn luyện hội thoại theo tình huống: hãy đóng vai phù hợp, trả lời chủ yếu bằng ${language}, ` +
        'kèm giải thích tiếng Việt khi cần, và gợi ý câu tiếp theo.'
      );
    case 'general':
    default:
      return common;
  }
}

function senseBlock(sense: AiSenseContext): string {
  const lines = [
    'NGỮ CẢNH TỪ ĐIỂN (chỉ dùng khi hữu ích, không bịa thêm nghĩa ngoài dữ liệu):',
    `- Từ: ${sense.lemma}${sense.reading ? ` (${sense.reading})` : ''}`,
  ];
  if (sense.pos) {
    lines.push(`- Từ loại: ${sense.pos}`);
  }
  if (sense.glossVi) {
    lines.push(
      `- Nghĩa tiếng Việt: ${sense.glossVi}${sense.glossViMachine ? ' (gloss máy, chưa kiểm duyệt)' : ''}`,
    );
  }
  if (sense.glossEn) {
    lines.push(`- Nghĩa tiếng Anh: ${sense.glossEn}`);
  }
  if (sense.example) {
    lines.push(`- Ví dụ: ${sense.example.text}`);
  }
  return lines.join('\n');
}

function languageName(code: string): string {
  switch (code) {
    case 'ja':
      return 'tiếng Nhật';
    case 'en':
      return 'tiếng Anh';
    case 'zh-Hans':
      return 'tiếng Trung (giản thể)';
    case 'vi':
      return 'tiếng Việt';
    default:
      return code;
  }
}

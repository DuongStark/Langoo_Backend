import { buildChatMessages, CHAT_HISTORY_LIMIT } from './context-builder';

const base = {
  scenario: 'general' as const,
  targetLanguage: 'ja',
  history: [{ role: 'user' as const, content: 'xin chào' }],
};

describe('buildChatMessages', () => {
  it('luôn có system prompt đầu tiên và giữ thứ tự history', () => {
    const messages = buildChatMessages(base);

    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('tiếng Nhật');
    expect(messages[1]).toEqual({ role: 'user', content: 'xin chào' });
  });

  it('system prompt khác nhau theo scenario', () => {
    const grammar = buildChatMessages({ ...base, scenario: 'grammar' });
    const conversation = buildChatMessages({
      ...base,
      scenario: 'conversation',
    });

    expect(grammar[0].content).toContain('ngữ pháp');
    expect(conversation[0].content).toContain('hội thoại');
  });

  it('chèn block ngữ cảnh sense khi có ref', () => {
    const messages = buildChatMessages({
      ...base,
      senseContext: {
        senseId: '1',
        lemma: '走る',
        reading: 'はしる',
        pos: 'verb',
        glossVi: 'chạy',
        glossEn: 'to run',
        glossViMachine: false,
        example: { text: '毎朝走ります。', translationVi: null },
      },
    });

    const senseBlock = messages.find(
      (m) => m.role === 'system' && m.content.includes('走る'),
    );
    expect(senseBlock).toBeDefined();
    expect(senseBlock?.content).toContain('NGỮ CẢNH TỪ ĐIỂN');
    expect(senseBlock?.content).toContain('chạy');
  });

  it('cắt history còn đúng CHAT_HISTORY_LIMIT tin gần nhất', () => {
    const history = Array.from({ length: 30 }, (_, index) => ({
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `m${index}`,
    }));

    const messages = buildChatMessages({ ...base, history });
    const historyMessages = messages.filter((m) => m.role !== 'system');

    expect(historyMessages).toHaveLength(CHAT_HISTORY_LIMIT);
    expect(historyMessages[0].content).toBe(`m${30 - CHAT_HISTORY_LIMIT}`);
    expect(historyMessages.at(-1)!.content).toBe('m29');
  });
});

import { StubChatProvider } from './stub-chat.provider';

describe('StubChatProvider', () => {
  const provider = new StubChatProvider();

  it('trả lời demo deterministic khi không có ngữ cảnh sense', async () => {
    const result = await provider.chat({
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'Xin chào' },
      ],
      model: 'stub-v1',
      timeoutMs: 1000,
    });

    expect(result.content).toContain('[stub]');
    expect(result.content).toContain('Xin chào');
    expect(result.model).toBe('stub-v1');
    expect(result.costUsd).toBe(0);
    expect(result.tokensIn).toBeGreaterThan(0);
    expect(result.tokensOut).toBeGreaterThan(0);
  });

  it('ưu tiên ngữ cảnh sense: nêu gloss + ví dụ + cờ gloss máy', async () => {
    const result = await provider.chat({
      messages: [{ role: 'user', content: '走る nghĩa là gì?' }],
      model: 'stub-v1',
      timeoutMs: 1000,
      senseContext: {
        senseId: '1',
        lemma: '走る',
        reading: 'はしる',
        pos: 'verb',
        glossVi: 'chạy',
        glossEn: 'to run',
        glossViMachine: true,
        example: {
          text: '毎朝、公園を走ります。',
          translationVi: 'Tôi chạy trong công viên mỗi sáng.',
        },
      },
    });

    expect(result.content).toContain('走る');
    expect(result.content).toContain('chạy');
    expect(result.content).toContain('gloss máy, chưa duyệt');
    expect(result.content).toContain('毎朝、公園を走ります。');
    expect(result.content).toContain('Tôi chạy trong công viên mỗi sáng.');
  });

  it('cắt nội dung echo dài quá 200 ký tự', async () => {
    const long = 'a'.repeat(500);
    const result = await provider.chat({
      messages: [{ role: 'user', content: long }],
      model: 'stub-v1',
      timeoutMs: 1000,
    });

    expect(result.content).not.toContain(long);
    expect(result.content).toContain('…');
  });
});

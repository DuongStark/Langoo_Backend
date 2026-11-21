import { randomUUID } from 'node:crypto';
import { AiModelDispatch } from './ai-model-dispatch';
import { OpenAiChatProvider } from './openai-chat.provider';

describe('M11.3 shared model dispatch', () => {
  it('paces separate transports sharing credential, origin and model', async () => {
    const original = global.fetch;
    const model = randomUUID();
    const baseUrl = 'https://provider.invalid/v1';
    const apiKey = 'synthetic-key';
    const starts: number[] = [];
    global.fetch = jest.fn(() => {
      starts.push(Date.now());
      return Promise.resolve(
        new Response(
          JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
          { status: 200 },
        ),
      );
    });
    // Mốc pacing đặt ở gate; fetch chạy sau vài bước async nên đo ở fetch lệch vài ms.
    // Interval 50 ms + ngưỡng 40 ms vẫn chứng minh có pacing (không pacing ≈ 0 ms).
    AiModelDispatch.configure(
      AiModelDispatch.scope(baseUrl, apiKey, model),
      50,
    );
    try {
      const a = new OpenAiChatProvider({ baseUrl, apiKey });
      const b = new OpenAiChatProvider({ baseUrl: baseUrl + '/', apiKey });
      await Promise.all(
        [a, b, a].map((provider) =>
          provider.chat({ model, timeoutMs: 2000, messages: [] }),
        ),
      );
      expect(starts).toHaveLength(3);
      expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(40);
      expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(40);
    } finally {
      global.fetch = original;
    }
  });

  it('checks consent after waiting and never dispatches rejected/aborted calls', async () => {
    const scope = randomUUID();
    AiModelDispatch.configure(scope, 15);
    const controller = new AbortController();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = AiModelDispatch.wait(
      scope,
      new AbortController().signal,
      () => held,
    );
    const blocked = jest.fn().mockResolvedValue(undefined);
    const second = AiModelDispatch.wait(
      scope,
      controller.signal,
      blocked,
    ).catch((e: Error) => e);
    controller.abort();
    release();
    await first;
    expect(await second).toMatchObject({ name: 'AbortError' });
    expect(blocked).not.toHaveBeenCalled();
    await expect(
      AiModelDispatch.wait(scope, new AbortController().signal, () =>
        Promise.reject(new Error('consent')),
      ),
    ).rejects.toThrow('consent');
    await expect(
      AiModelDispatch.wait(scope, new AbortController().signal),
    ).resolves.toBeUndefined();
  });
});

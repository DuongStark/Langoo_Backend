import { OpenAiChatProvider } from './openai-chat.provider';

const originalFetch = global.fetch;

function mockFetch(
  handler: (url: string, init: RequestInit) => Promise<Response>,
): jest.Mock {
  const fetchMock = jest.fn(handler);
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe('OpenAiChatProvider', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('gọi đúng endpoint /chat/completions và map usage của provider', async () => {
    const fetchMock = mockFetch(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            model: 'zen-model-1',
            choices: [{ message: { content: 'Xin chào!' } }],
            usage: { prompt_tokens: 12, completion_tokens: 3 },
          }),
          { status: 200 },
        ),
      ),
    );
    const provider = new OpenAiChatProvider({
      baseUrl: 'https://opencode.ai/zen/v1/',
      apiKey: 'zen-key',
    });

    const result = await provider.chat({
      messages: [{ role: 'user', content: 'hi' }],
      model: 'zen-model-1',
      timeoutMs: 5000,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://opencode.ai/zen/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe(
      'Bearer zen-key',
    );
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'zen-model-1',
    });

    expect(result).toEqual({
      content: 'Xin chào!',
      model: 'zen-model-1',
      tokensIn: 12,
      tokensOut: 3,
      costUsd: 0,
    });
  });

  it('thiếu usage → ước lượng token thay vì bịa số 0', async () => {
    mockFetch(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'abcd' } }],
          }),
          { status: 200 },
        ),
      ),
    );
    const provider = new OpenAiChatProvider({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'k',
    });

    const result = await provider.chat({
      messages: [{ role: 'user', content: '12345678' }],
      model: 'm',
      timeoutMs: 5000,
    });

    expect(result.tokensIn).toBe(2);
    expect(result.tokensOut).toBe(1);
  });

  it('HTTP lỗi → throw để service map thành 503', async () => {
    mockFetch(async () =>
      Promise.resolve(new Response('rate limited', { status: 429 })),
    );
    const provider = new OpenAiChatProvider({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'k',
    });

    await expect(
      provider.chat({
        messages: [{ role: 'user', content: 'hi' }],
        model: 'm',
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(/HTTP 429/);
  });

  it('nội dung rỗng → throw', async () => {
    mockFetch(async () =>
      Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: {} }] }), {
          status: 200,
        }),
      ),
    );
    const provider = new OpenAiChatProvider({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'k',
    });

    await expect(
      provider.chat({
        messages: [{ role: 'user', content: 'hi' }],
        model: 'm',
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(/rỗng/);
  });
});

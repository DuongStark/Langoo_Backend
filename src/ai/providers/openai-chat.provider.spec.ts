import { AiProviderError } from './ai-chat.provider';
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

  it('chatStream: ghép delta, bỏ reasoning, đọc model + usage từ chunk', async () => {
    const encoder = new TextEncoder();
    const sse = (...parts: string[]): Response =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const part of parts) {
              controller.enqueue(encoder.encode(part));
            }
            controller.close();
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );

    mockFetch(async () =>
      Promise.resolve(
        sse(
          'data: {"choices":[{"delta":{"reasoning_content":"nghĩ thầm"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"Xin "}}],"model":"gpt-oss-120b"}\n',
          'data: {"choices":[{"delta":{"content":"chào"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"!"}}],"usage":{"prompt_tokens":5,"completion_tokens":3}}\n\n',
          'data: [DONE]\n\n',
        ),
      ),
    );
    const provider = new OpenAiChatProvider({
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: 'k',
    });

    const deltas: string[] = [];
    const result = await provider.chatStream(
      {
        messages: [{ role: 'user', content: 'hi' }],
        model: 'gpt-oss-120b',
        timeoutMs: 5000,
      },
      (delta) => deltas.push(delta),
    );

    expect(deltas).toEqual(['Xin ', 'chào', '!']);
    expect(result).toMatchObject({
      content: 'Xin chào!',
      model: 'gpt-oss-120b',
      tokensIn: 5,
      tokensOut: 3,
      costUsd: 0,
    });
  });

  it('chatStream: gửi max_tokens + reasoning_effort + stream=true khi cấu hình', async () => {
    const fetchMock = mockFetch(async () =>
      Promise.resolve(
        new Response(
          'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n',
          { status: 200 },
        ),
      ),
    );
    const provider = new OpenAiChatProvider({
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: 'k',
    });

    await provider.chatStream(
      {
        messages: [{ role: 'user', content: 'hi' }],
        model: 'm',
        timeoutMs: 5000,
        maxTokens: 256,
        reasoningEffort: 'low',
      },
      () => undefined,
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      stream: true,
      max_tokens: 256,
      reasoning_effort: 'low',
    });
  });

  it('chatStream: chỉ có reasoning, không content → coi là lỗi rỗng', async () => {
    mockFetch(async () =>
      Promise.resolve(
        new Response(
          'data: {"choices":[{"delta":{"reasoning_content":"..."}}]}\n\ndata: [DONE]\n\n',
          { status: 200 },
        ),
      ),
    );
    const provider = new OpenAiChatProvider({
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: 'k',
    });

    await expect(
      provider.chatStream(
        {
          messages: [{ role: 'user', content: 'hi' }],
          model: 'm',
          timeoutMs: 5000,
        },
        () => undefined,
      ),
    ).rejects.toThrow(/rỗng/);
  });

  it('chatStream: HTTP 429 → AiProviderError.retryable = true', async () => {
    mockFetch(async () =>
      Promise.resolve(new Response('rate limited', { status: 429 })),
    );
    const provider = new OpenAiChatProvider({
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: 'k',
    });

    let caught: unknown;
    try {
      await provider.chatStream(
        {
          messages: [{ role: 'user', content: 'hi' }],
          model: 'm',
          timeoutMs: 5000,
        },
        () => undefined,
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AiProviderError);
    const providerError = caught as AiProviderError;
    expect(providerError.status).toBe(429);
    expect(providerError.retryable).toBe(true);
  });
});

describe('M10.3 multimodal transport', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });
  it.each([false, true])(
    'sends only OpenAI content parts; errors cannot echo images (stream=%s)',
    async (stream) => {
      const image = 'data:image/png;base64,PRIVATE';
      const fetchMock = mockFetch(async () =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { message: image } }), {
            status: 400,
          }),
        ),
      );
      const provider = new OpenAiChatProvider({
        baseUrl: 'https://example.test',
        apiKey: 'fixture',
      });
      const req = {
        model: 'qwen',
        messages: [{ role: 'user' as const, content: 'read', images: [image] }],
        timeoutMs: 1000,
      };
      const promise = stream
        ? provider.chatStream(req, jest.fn())
        : provider.chat(req);
      await expect(promise).rejects.toMatchObject({
        message: 'provider HTTP 400',
        status: 400,
      });
      const body = JSON.parse(
        (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
      ) as { messages: unknown[] };
      expect(body.messages).toEqual([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'read' },
            { type: 'image_url', image_url: { url: image } },
          ],
        },
      ]);
    },
  );
});

describe('M10.3 image token fallback', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });
  it('accounts for images when upstream omits usage without counting base64 as text', async () => {
    mockFetch(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
          { status: 200 },
        ),
      ),
    );
    const provider = new OpenAiChatProvider({
      baseUrl: 'https://example.test',
      apiKey: 'fixture',
    });
    const result = await provider.chat({
      model: 'qwen/qwen3.8-27b',
      messages: [
        {
          role: 'user',
          content: 'read',
          images: ['data:image/png;base64,PRIVATE'],
        },
      ],
      timeoutMs: 1000,
    });
    expect(result.tokensIn).toBe(2049);
  });
});

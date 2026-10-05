import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { AiChatRequest } from './ai-chat.provider';
import { OpenAiChatProvider } from './openai-chat.provider';

const originalFetch = global.fetch;
const request: AiChatRequest = {
  messages: [{ role: 'user', content: 'hi' }],
  model: 'configured-model',
  timeoutMs: 5000,
};

function provider(baseUrl = 'https://provider.invalid/v1') {
  return new OpenAiChatProvider({ baseUrl, apiKey: 'test-only-key' });
}

function response(parts: Uint8Array[], close = true, cancel = jest.fn()) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        parts.forEach((part) => controller.enqueue(part));
        if (close) controller.close();
      },
      cancel,
    }),
  );
}

function mockText(text: string) {
  global.fetch = jest
    .fn()
    .mockResolvedValue(
      response([new TextEncoder().encode(text)]),
    ) as typeof fetch;
}

describe('OpenAI stream protocol regressions', () => {
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it.each(['\n', '\r\n', '\r'])(
    'parses multiline events with %j and byte-split UTF-8',
    async (newline) => {
      const text = [
        ': heartbeat',
        'event: message',
        'data: {"choices":',
        'data: [{"delta":{"content":"Chào 走る"}}],"model":"actual-model"}',
        '',
        'data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":3}}',
        '',
        'data: [DONE]',
        '',
        '',
      ].join(newline);
      global.fetch = jest
        .fn()
        .mockResolvedValue(
          response(
            [...new TextEncoder().encode(text)].map((byte) =>
              Uint8Array.of(byte),
            ),
          ),
        ) as typeof fetch;
      const deltas: string[] = [];
      const result = await provider().chatStream(request, (delta) =>
        deltas.push(delta),
      );
      expect(deltas).toEqual(['Chào 走る']);
      expect(result).toMatchObject({
        content: 'Chào 走る',
        model: 'actual-model',
        tokensIn: 7,
        tokensOut: 3,
      });
    },
  );

  it('rejects EOF after a partial answer instead of accepting it', async () => {
    mockText('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
    await expect(
      provider().chatStream(request, () => undefined),
    ).rejects.toThrow();
  });

  it('keeps a standalone blank LF following an already complete CRLF', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        response([
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"ok"}}]}\r\n',
          ),
          new TextEncoder().encode('\ndata: [DONE]\r\n'),
          new TextEncoder().encode('\n'),
        ]),
      ) as typeof fetch;
    expect(
      (await provider().chatStream(request, () => undefined)).content,
    ).toBe('ok');
  });

  it.each([
    '{broken',
    'null',
    '{"error":{"message":"private upstream detail"}}',
  ])('rejects malformed/error event %s after content', async (frame) => {
    mockText(
      `data: {"choices":[{"delta":{"content":"partial"}}]}\n\ndata: ${frame}\n\ndata: [DONE]\n\n`,
    );
    await expect(
      provider().chatStream(request, () => undefined),
    ).rejects.toThrow();
  });

  it('does not dispatch an unterminated final event', async () => {
    mockText(
      'data: {"choices":[{"delta":{"content":"partial"}}]}\n\ndata: [DONE]',
    );
    await expect(
      provider().chatStream(request, () => undefined),
    ).rejects.toThrow();
  });

  it.each(['\n', '\r\n', '\r'])(
    'stops at DONE with %j while upstream remains open',
    async (newline) => {
      const cancel = jest.fn();
      const upstream = response(
        [
          new TextEncoder().encode(
            `data: {"choices":[{"delta":{"content":"ok"}}]}${newline}${newline}data: [DONE]${newline}${newline}`,
          ),
        ],
        false,
        cancel,
      );
      global.fetch = jest.fn().mockResolvedValue(upstream) as typeof fetch;
      // Test deadline cancels the mock stream too, so the old parser cannot hang Jest.
      let deadlineFired = false;
      const timer = setTimeout(() => {
        deadlineFired = true;
        // The stream is locked by the provider: abort the reader through its signal.
        failStream?.();
      }, 200);
      let failStream: (() => void) | undefined;
      const originalReader = upstream.body!.getReader.bind(upstream.body!);
      jest.spyOn(upstream.body!, 'getReader').mockImplementation(() => {
        const reader = originalReader();
        failStream = () => {
          void reader.cancel();
        };
        return reader;
      });
      try {
        const result = await provider().chatStream(request, () => undefined);
        expect(result.content).toBe('ok');
        expect(deadlineFired).toBe(false);
        expect(upstream.body!.locked).toBe(false);
        expect(cancel).toHaveBeenCalledTimes(1);
      } finally {
        clearTimeout(timer);
      }
    },
  );

  it('discards bytes after DONE', async () => {
    mockText(
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\ndata: {"choices":[{"delta":{"content":"extra"}}]}\n\n',
    );
    const result = await provider().chatStream(request, () => undefined);
    expect(result.content).toBe('ok');
  });

  it('HTTP errors retain status without copying upstream secrets into the error', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        new Response('private prompt test-only-key', { status: 429 }),
      ) as typeof fetch;
    await expect(
      provider().chatStream(request, () => undefined),
    ).rejects.toMatchObject({
      status: 429,
      retryable: true,
      message: 'provider HTTP 429',
    });
  });

  it('invalid token counts fall back to estimates rather than overflowing DB integers', async () => {
    mockText(
      'data: {"choices":[{"delta":{"content":"abcd"}}],"usage":{"prompt_tokens":1e300,"completion_tokens":1.5}}\n\ndata: [DONE]\n\n',
    );
    const result = await provider().chatStream(request, () => undefined);
    expect(result.tokensIn).toBe(1);
    expect(result.tokensOut).toBe(1);
  });
});

describe('OpenAI abort handling with real local HTTP', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(': waiting\n\n');
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it('internal timeout is recognizable by the retry policy', async () => {
    await expect(
      provider(baseUrl).chatStream(
        { ...request, timeoutMs: 50 },
        () => undefined,
      ),
    ).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('external abort interrupts upstream', async () => {
    const abort = new AbortController();
    const pending = provider(baseUrl).chatStream(
      { ...request, signal: abort.signal },
      () => undefined,
    );
    const assertion = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
    });
    abort.abort();
    await assertion;
  });
});

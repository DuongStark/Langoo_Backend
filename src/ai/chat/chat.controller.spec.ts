import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { ChatController } from './chat.controller';
import { ChatService, ChatStreamEvent } from './chat.service';

const sessionId = '01900000-0000-7000-8000-000000000001';

describe('ChatController stream disconnect handling', () => {
  function setup() {
    const request = Object.assign(new EventEmitter(), { aborted: false });
    const response = Object.assign(new EventEmitter(), {
      writableEnded: false,
      destroyed: false,
      writeHead: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
    });
    const sendMessageStream = jest.fn();
    const controller = new ChatController({
      sendMessageStream,
    } as unknown as ChatService);
    const run = () =>
      controller.streamMessage(
        { sub: '1', sid: sessionId, typ: 'access' },
        sessionId,
        { content: 'hi' },
        request as unknown as Request,
        response as unknown as Response,
      );
    return { request, response, sendMessageStream, run };
  }

  it('request body close is not treated as a client disconnect', async () => {
    const s = setup();
    s.sendMessageStream.mockImplementation(
      (_user, _id, _dto, _emit, signal: AbortSignal) => {
        s.request.emit('close');
        expect(signal.aborted).toBe(false);
        return Promise.resolve();
      },
    );
    await s.run();
    expect(s.request.listenerCount('close')).toBe(0);
  });

  it('response socket close aborts the upstream signal and removes listeners', async () => {
    const s = setup();
    s.sendMessageStream.mockImplementation(
      (_user, _id, _dto, _emit, signal: AbortSignal) => {
        s.response.destroyed = true;
        s.response.emit('close');
        expect(signal.aborted).toBe(true);
        return Promise.reject(new DOMException('client closed', 'AbortError'));
      },
    );
    await s.run();
    expect(s.response.write).not.toHaveBeenCalled();
    expect(s.response.listenerCount('close')).toBe(0);
  });

  it('unexpected exception after headers becomes a terminal SSE error', async () => {
    const s = setup();
    s.sendMessageStream.mockImplementation(
      (_user, _id, _dto, emit: (event: ChatStreamEvent) => void) => {
        emit({ type: 'start', model: 'stub' });
        emit({ type: 'delta', content: 'partial' });
        return Promise.reject(new Error('private error'));
      },
    );
    await s.run();
    expect(
      s.response.write.mock.calls.map((call: [string]) => call[0]).join(''),
    ).toContain('event: error');
    expect(
      s.response.write.mock.calls.map((call: [string]) => call[0]).join(''),
    ).not.toContain('private error');
    expect(s.response.end).toHaveBeenCalledTimes(1);
  });
});

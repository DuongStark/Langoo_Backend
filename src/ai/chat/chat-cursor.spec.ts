import {
  decodeChatMessageCursor,
  decodeChatSessionCursor,
  encodeChatMessageCursor,
  encodeChatSessionCursor,
} from './chat-cursor';

describe('chat cursor', () => {
  it('round-trip cursor phiên chat (uuid)', () => {
    const createdAt = new Date('2026-09-29T10:00:00.000Z');
    const id = '01900000-0000-7000-8000-000000000001';

    const raw = encodeChatSessionCursor({ createdAt, id });
    const decoded = decodeChatSessionCursor(raw);

    expect(decoded.createdAt.toISOString()).toBe(createdAt.toISOString());
    expect(decoded.id).toBe(id);
  });

  it('round-trip cursor tin nhắn (bigint)', () => {
    const createdAt = new Date('2026-09-29T10:00:00.000Z');
    const id = 123n;

    const raw = encodeChatMessageCursor({ createdAt, id });
    const decoded = decodeChatMessageCursor(raw);

    expect(decoded.createdAt.toISOString()).toBe(createdAt.toISOString());
    expect(decoded.id).toBe(id);
  });

  it('cursor sai/phiên bản lạ/định dạng lạ → 400 VALIDATION_FAILED', () => {
    const bad = [
      'not-base64!',
      Buffer.from(JSON.stringify({ v: 2, t: 'x', i: 'y' })).toString(
        'base64url',
      ),
      Buffer.from(
        JSON.stringify({ v: 1, t: 'khong-phai-iso', i: '1' }),
      ).toString('base64url'),
    ];
    for (const raw of bad) {
      expect(() => decodeChatMessageCursor(raw)).toThrow('Cursor không hợp lệ');
    }

    const badSession = Buffer.from(
      JSON.stringify({
        v: 1,
        t: '2026-09-29T10:00:00.000Z',
        i: 'khong-phai-uuid',
      }),
    ).toString('base64url');
    expect(() => decodeChatSessionCursor(badSession)).toThrow(
      'Cursor không hợp lệ',
    );
  });
});

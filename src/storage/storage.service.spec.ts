import { assertSafeStorageKey, sniffImageMime } from './storage.service';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP'),
  Buffer.from([0x56, 0x50, 0x38, 0x20]),
]);

describe('storage helpers', () => {
  it('nhận diện ảnh bằng magic bytes', () => {
    expect(sniffImageMime(PNG)).toBe('image/png');
    expect(sniffImageMime(JPEG)).toBe('image/jpeg');
    expect(sniffImageMime(WEBP)).toBe('image/webp');
  });

  it('trả null với tệp không phải ảnh hoặc quá ngắn', () => {
    expect(sniffImageMime(Buffer.from('hello world'))).toBeNull();
    expect(sniffImageMime(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(sniffImageMime(Buffer.alloc(0))).toBeNull();
    // RIFF nhưng không phải WEBP (ví dụ WAV)
    expect(
      sniffImageMime(
        Buffer.concat([
          Buffer.from('RIFF'),
          Buffer.from([0, 0, 0, 0]),
          Buffer.from('WAVE'),
        ]),
      ),
    ).toBeNull();
  });

  it('chấp nhận key an toàn, chặn traversal/ký tự lạ', () => {
    expect(() => assertSafeStorageKey('feedback/12/abc.png')).not.toThrow();
    expect(() => assertSafeStorageKey('a-b_c/1.jpg')).not.toThrow();

    expect(() => assertSafeStorageKey('../etc/passwd')).toThrow();
    expect(() => assertSafeStorageKey('feedback/../../x.png')).toThrow();
    expect(() => assertSafeStorageKey('Feedback/1.png')).toThrow();
    expect(() => assertSafeStorageKey('')).toThrow();
    expect(() => assertSafeStorageKey(`a/${'x'.repeat(250)}.png`)).toThrow();
  });
});

import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { validateChatImages, CHAT_IMAGE_MAX_BYTES } from './chat-images';
import { SendChatMessageDto } from './dto/chat.dto';

const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII=';
describe('M10.3 image validation', () => {
  it('supports existing text-only and up to three request-only images', () => {
    expect(validateChatImages(undefined)).toBeUndefined();
    expect(validateChatImages([png, png, png])).toEqual([png, png, png]);
  });
  it.each([
    null,
    [],
    [png, png, png, png],
    ['https://example.test/a.png'],
    ['data:image/svg+xml;base64,PHN2Zz4='],
    ['data:image/jpeg;base64,aGVsbG8='],
    ['data:image/png;base64,@@'],
    [1],
    [png.replace('CYII=', 'CYII')],
  ])(
    'rejects malformed type/base64/signature without echoing input',
    (input) => {
      expect(() => validateChatImages(input)).toThrow('Gửi 1–3 ảnh');
    },
  );
  it('rejects decoded size exceeding the per-image limit', () => {
    const oversized =
      'data:image/png;base64,' +
      Buffer.alloc(CHAT_IMAGE_MAX_BYTES + 1).toString('base64');
    expect(() => validateChatImages([oversized])).toThrow();
  });
  it('DTO rejects null/nonstrings/excess images and does not return raw values', async () => {
    for (const images of [null, [null], Array(4).fill(png)]) {
      const errors = await validate(
        plainToInstance(SendChatMessageDto, { content: 'hi', images }),
      );
      expect(errors.some((e) => e.property === 'images')).toBe(true);
    }
  });
});

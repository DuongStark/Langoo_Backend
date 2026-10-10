import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';

export const CHAT_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const MAX_BASE64_LENGTH = 4 * Math.ceil(CHAT_IMAGE_MAX_BYTES / 3);

/** Validate bytes in memory. Never fetch URLs or write temporary image files. */
export function validateChatImages(images: unknown): string[] | undefined {
  if (images === undefined) return undefined;
  const invalid = (): never => {
    throw new DomainException(
      'CHAT_IMAGES_INVALID',
      'Gửi 1–3 ảnh PNG/JPEG/WebP dạng base64, tối đa 2 MiB mỗi ảnh',
      HttpStatus.BAD_REQUEST,
    );
  };
  if (!Array.isArray(images) || images.length < 1 || images.length > 3)
    return invalid();
  for (const image of images) {
    if (typeof image !== 'string' || image.length > MAX_BASE64_LENGTH + 32)
      return invalid();
    const match =
      /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
    if (!match || match[2].length > MAX_BASE64_LENGTH) return invalid();
    const bytes = Buffer.from(match[2], 'base64');
    if (
      !bytes.length ||
      bytes.length > CHAT_IMAGE_MAX_BYTES ||
      bytes.toString('base64') !== match[2]
    )
      return invalid();
    const format = match[1];
    const valid =
      format === 'png'
        ? bytes.length >= 33 &&
          bytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
          bytes.toString('ascii', 12, 16) === 'IHDR'
        : format === 'jpeg'
          ? bytes.length >= 4 &&
            bytes[0] === 255 &&
            bytes[1] === 216 &&
            bytes[2] === 255 &&
            bytes[bytes.length - 2] === 255 &&
            bytes[bytes.length - 1] === 217
          : bytes.length >= 20 &&
            bytes.toString('ascii', 0, 4) === 'RIFF' &&
            bytes.toString('ascii', 8, 12) === 'WEBP' &&
            bytes.readUInt32LE(4) + 8 === bytes.length;
    if (!valid) return invalid();
  }
  return images as string[];
}

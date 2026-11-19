import { ConfigService } from '@nestjs/config';
import argon2 from 'argon2';

/** Argon2id policy dùng chung cho register, reset mật khẩu và verify. */
export async function hashPassword(
  config: ConfigService,
  password: string,
): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: config.getOrThrow<number>('ARGON2_MEMORY_COST'),
    timeCost: config.getOrThrow<number>('ARGON2_TIME_COST'),
    parallelism: 1,
  });
}

/** Hash lưu DB có thể hỏng (seed/di trú) — coi như sai mật khẩu, không 500. */
export async function verifyPassword(
  storedHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await argon2.verify(storedHash, password);
  } catch {
    return false;
  }
}

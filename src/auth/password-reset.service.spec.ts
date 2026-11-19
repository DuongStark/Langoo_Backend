import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../db/prisma.service';
import { PasswordResetMailer } from './password-reset.mailer';
import { PasswordResetService } from './password-reset.service';

describe('PasswordResetService config gate', () => {
  const config = {
    getOrThrow: jest.fn(),
    get: jest.fn(),
  } as unknown as ConfigService;

  it('thiếu cấu hình email → forgot/reset đều 503 và không chạm DB', async () => {
    const prisma = {
      userIdentity: { findUnique: jest.fn() },
      passwordResetChallenge: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };
    const mailer = {
      isConfigured: jest.fn(() => false),
      sendResetLink: jest.fn(),
    };
    const service = new PasswordResetService(
      prisma as unknown as PrismaService,
      config,
      mailer as unknown as PasswordResetMailer,
    );

    await expect(
      service.forgot({ email: 'user@example.com' }),
    ).rejects.toMatchObject({
      code: 'AUTH_PASSWORD_RESET_UNAVAILABLE',
    });
    await expect(
      service.reset({
        token: 'A'.repeat(43),
        new_password: 'matkhau-moi-123',
      }),
    ).rejects.toMatchObject({
      code: 'AUTH_PASSWORD_RESET_UNAVAILABLE',
    });
    expect(prisma.userIdentity.findUnique).not.toHaveBeenCalled();
    expect(prisma.passwordResetChallenge.findUnique).not.toHaveBeenCalled();
    expect(mailer.sendResetLink).not.toHaveBeenCalled();
  });
});

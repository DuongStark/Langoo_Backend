import { ConfigService } from '@nestjs/config';
import { PasswordResetMailer, buildResetLink } from './password-reset.mailer';

describe('PasswordResetMailer', () => {
  const token = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0UvW';
  const values: Record<string, string> = {
    AUTH_PASSWORD_RESET_URL: 'https://app.langoo.org/reset-password',
    RESEND_API_KEY: 'test-key',
    AUTH_PASSWORD_RESET_FROM: 'Langoo <no-reply@langoo.org>',
  };
  const config = {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('gắn token vào fragment, không query/path và gửi tới Resend cố định', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true, status: 200 } as Response);
    const mailer = new PasswordResetMailer(config);

    expect(mailer.isConfigured()).toBe(true);
    await mailer.sendResetLink('user@example.com', token);

    expect(buildResetLink(values.AUTH_PASSWORD_RESET_URL, token)).toBe(
      `https://app.langoo.org/reset-password#token=${token}`,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(init?.body as string) as {
      to: string[];
      text: string;
    };
    expect(body.to).toEqual(['user@example.com']);
    expect(body.text).toContain(
      `https://app.langoo.org/reset-password#token=${token}`,
    );
    expect(body.text).not.toContain(`/reset-password/${token}`);
  });

  it('thiếu một trong ba biến → không cấu hình, không gọi provider', async () => {
    const missing = {
      get: jest.fn((key: string) =>
        key === 'RESEND_API_KEY' ? undefined : values[key],
      ),
    } as unknown as ConfigService;
    const fetchMock = jest.spyOn(global, 'fetch');
    const mailer = new PasswordResetMailer(missing);

    expect(mailer.isConfigured()).toBe(false);
    await mailer.sendResetLink('user@example.com', token);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 10_000;
const RESET_SUBJECT = 'Đặt lại mật khẩu Langoo';
const RESET_TTL_LABEL = '15 phút';

interface ResetMailConfig {
  resetUrl: string;
  apiKey: string;
  from: string;
}

/**
 * Gửi liên kết đặt lại mật khẩu qua Resend bằng fetch gốc.
 *
 * Token chỉ nằm trong fragment `#token=...` của link, nên không bao giờ được
 * gửi tới web server của FE và không bị ghi log. Provider lỗi chỉ cảnh báo
 * trạng thái chung; không log request/response body hay raw link.
 */
@Injectable()
export class PasswordResetMailer {
  private readonly logger = new Logger(PasswordResetMailer.name);

  constructor(private readonly config: ConfigService) {}

  /** Bật API chỉ khi đủ cả URL, API key và địa chỉ gửi. */
  isConfigured(): boolean {
    return this.readConfig() !== null;
  }

  async sendResetLink(to: string, token: string): Promise<void> {
    const config = this.readConfig();
    if (config === null) {
      this.logger.warn('Bỏ qua gửi email đặt lại mật khẩu: thiếu cấu hình');
      return;
    }

    const link = buildResetLink(config.resetUrl, token);
    const body = {
      from: config.from,
      to: [to],
      subject: RESET_SUBJECT,
      text: [
        'Có yêu cầu đặt lại mật khẩu cho tài khoản Langoo của bạn.',
        '',
        `Mở liên kết sau để đặt mật khẩu mới (hết hạn sau ${RESET_TTL_LABEL}):`,
        link,
        '',
        'Nếu bạn không yêu cầu, hãy bỏ qua email này.',
      ].join('\n'),
    };

    try {
      const response = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn(
          `Gửi email đặt lại mật khẩu thất bại (provider status=${response.status})`,
        );
      }
    } catch {
      this.logger.warn('Gửi email đặt lại mật khẩu thất bại (lỗi kết nối)');
    }
  }

  private readConfig(): ResetMailConfig | null {
    const resetUrl = this.config.get<string>('AUTH_PASSWORD_RESET_URL')?.trim();
    const apiKey = this.config.get<string>('RESEND_API_KEY')?.trim();
    const from = this.config.get<string>('AUTH_PASSWORD_RESET_FROM')?.trim();
    if (!resetUrl || !apiKey || !from) {
      return null;
    }
    return { resetUrl, apiKey, from };
  }
}

/** Link cố định từ cấu hình + fragment; không dựng từ Host của request. */
export function buildResetLink(resetUrl: string, token: string): string {
  return `${resetUrl}#token=${token}`;
}

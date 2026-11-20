import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 10_000;
const RESET_SUBJECT = 'Đặt lại mật khẩu tài khoản Langoo';
const RESET_TTL_LABEL = '15 phút';
const LANGOO_LOGO_URL = 'https://langoo.org/favicon.png';

interface ResetMailConfig {
  resetUrl: string;
  apiKey: string;
  from: string;
}

/**
 * Gửi liên kết đặt lại mật khẩu qua Resend bằng fetch gốc (HTML + plain-text).
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
      html: buildResetEmailHtml(link),
      text: buildResetEmailText(link),
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildResetEmailText(link: string): string {
  return [
    'Xin chào,',
    '',
    'Langoo vừa nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn.',
    '',
    'Vui lòng mở liên kết bên dưới để tạo mật khẩu mới:',
    link,
    '',
    'Lưu ý bảo mật:',
    `- Liên kết này chỉ có hiệu lực trong ${RESET_TTL_LABEL} và chỉ sử dụng được một lần.`,
    '- Sau khi đổi mật khẩu thành công, mọi phiên đăng nhập cũ trên các thiết bị khác sẽ tự động đăng xuất.',
    '- Không chia sẻ liên kết này cho bất kỳ ai.',
    '',
    'Nếu bạn không thực hiện yêu cầu này, bạn có thể yên tâm bỏ qua email — mật khẩu hiện tại của bạn vẫn được giữ nguyên an toàn.',
    '',
    'Trân trọng,',
    'Langoo — Học từ vựng tiếng Anh & tiếng Nhật thông minh (https://langoo.org)',
  ].join('\n');
}

/**
 * Giao diện email theo đúng ngôn ngữ thiết kế của Langoo:
 * "Phiếu mục lục & dấu kiểm duyệt" — nền giấy xanh nhạt (#f3f5fa),
 * mực navy chính thức (#1c3a8c), dấu nhấn đỏ cam (#d22d02) và logo gốc langoo.org.
 */
export function buildResetEmailHtml(link: string): string {
  const safeLink = escapeHtml(link);
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${RESET_SUBJECT}</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f5fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#1e2b4f;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">
    Liên kết đặt lại mật khẩu tài khoản Langoo của bạn có hiệu lực trong ${RESET_TTL_LABEL}.
  </div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f3f5fa;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background-color:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #dfe5f2;box-shadow:0 8px 28px -12px rgba(28,58,140,0.16);">
          <tr>
            <td style="padding:0;line-height:0;font-size:0;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td width="78%" style="height:4px;background-color:#1c3a8c;font-size:0;line-height:0;">&nbsp;</td>
                  <td width="22%" style="height:4px;background-color:#d22d02;font-size:0;line-height:0;">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 20px 32px;border-bottom:1px dashed #dfe5f2;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="left" valign="middle">
                    <a href="https://langoo.org" target="_blank" rel="noopener noreferrer" style="text-decoration:none;display:inline-block;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td valign="middle" style="padding-right:10px;">
                            <img src="${LANGOO_LOGO_URL}" width="40" height="40" alt="Langoo" style="display:block;border:0;width:40px;height:40px;border-radius:8px;background-color:#ffffff;" />
                          </td>
                          <td valign="middle">
                            <div style="font-size:21px;font-weight:800;line-height:1.1;color:#1c3a8c;letter-spacing:-0.4px;">
                              Langoo
                            </div>
                            <div style="font-size:10px;font-weight:700;line-height:1.3;color:#5d6b8a;letter-spacing:0.6px;text-transform:uppercase;margin-top:2px;">
                              Từ điển &amp; Sổ tay từ vựng
                            </div>
                          </td>
                        </tr>
                      </table>
                    </a>
                  </td>
                  <td align="right" valign="middle">
                    <span style="display:inline-block;padding:4px 10px;border:1.5px solid #d22d02;border-radius:6px;background-color:#fff5f2;color:#d22d02;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">
                      Hạn ${RESET_TTL_LABEL}
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:30px 32px 26px 32px;">
              <div style="font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#5d6b8a;margin-bottom:8px;">
                Xác thực tài khoản
              </div>
              <h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.35;font-weight:700;color:#162244;letter-spacing:-0.2px;">
                Đặt lại mật khẩu của bạn
              </h1>
              <p style="margin:0 0 12px 0;font-size:15px;line-height:1.65;color:#2b3a60;">
                Xin chào,
              </p>
              <p style="margin:0 0 24px 0;font-size:15px;line-height:1.65;color:#2b3a60;">
                Langoo vừa nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn. Bấm vào nút bên dưới để tạo mật khẩu mới và tiếp tục việc học nhé:
              </p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 26px 0;">
                <tr>
                  <td align="center" style="border-radius:10px;background-color:#1c3a8c;">
                    <a href="${safeLink}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 30px;font-size:15px;font-weight:600;color:#f8fafc;text-decoration:none;border-radius:10px;">
                      Đặt lại mật khẩu
                    </a>
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f6f8fc;border:1px solid #e2e8f4;border-left:3.5px solid #d22d02;border-radius:8px;margin:0 0 24px 0;">
                <tr>
                  <td style="padding:14px 16px;">
                    <div style="font-size:13px;font-weight:700;color:#162244;margin-bottom:6px;">
                      Lưu ý bảo mật
                    </div>
                    <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.65;color:#475574;">
                      <li>Liên kết chỉ có hiệu lực trong <strong style="color:#162244;">${RESET_TTL_LABEL}</strong> và dùng được <strong style="color:#162244;">1 lần duy nhất</strong>.</li>
                      <li>Sau khi đổi mật khẩu thành công, mọi phiên đăng nhập trên thiết bị khác sẽ tự động đăng xuất.</li>
                      <li>Tuyệt đối không chia sẻ đường dẫn này cho người khác.</li>
                    </ul>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px 0;font-size:12.5px;line-height:1.6;color:#5d6b8a;">
                Nếu nút bấm không hoạt động, bạn hãy sao chép và dán đường dẫn sau vào trình duyệt:
              </p>
              <p style="margin:0 0 22px 0;padding:10px 12px;background-color:#f6f8fc;border:1px solid #e2e8f4;border-radius:8px;font-size:12px;line-height:1.5;color:#1c3a8c;word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;">
                <a href="${safeLink}" style="color:#1c3a8c;text-decoration:underline;">${safeLink}</a>
              </p>
              <p style="margin:0;font-size:13px;line-height:1.6;color:#5d6b8a;">
                Nếu bạn không gửi yêu cầu này, bạn có thể bỏ qua email — tài khoản và mật khẩu hiện tại của bạn vẫn được giữ nguyên an toàn.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px;background-color:#f8fafd;border-top:1px solid #e6ecf5;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="left" style="font-size:12px;line-height:1.5;color:#64748b;">
                    <strong style="color:#1c3a8c;">Langoo</strong> · Học từ vựng tiếng Anh &amp; tiếng Nhật thông minh
                  </td>
                  <td align="right" style="font-size:12px;line-height:1.5;">
                    <a href="https://langoo.org" style="color:#1c3a8c;text-decoration:none;font-weight:600;">langoo.org</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

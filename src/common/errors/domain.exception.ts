import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Lỗi nghiệp vụ có mã domain (ví dụ AUTH_INVALID_CREDENTIALS, COLLECTION_NOT_FOUND).
 * Global exception filter sẽ trả nguyên {code, message, details?} ra response.
 */
export class DomainException extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    readonly details?: unknown,
  ) {
    super(
      { code, message, ...(details === undefined ? {} : { details }) },
      status,
    );
  }
}

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';

export interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

const STATUS_CODES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE_ENTITY',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
};

export function statusToCode(status: number): string {
  return (
    STATUS_CODES[status] ??
    (status >= 500 ? 'INTERNAL_ERROR' : `HTTP_${status}`)
  );
}

interface ErrorResponse {
  status: number;
  body: ErrorBody;
}

/**
 * Global exception filter — mọi lỗi ra response theo format {code, message, details?}.
 * Không lộ chi tiết nội bộ (stack trace, tên bảng) cho client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(AllExceptionsFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const { status, body } = this.toErrorResponse(exception);

    const logPayload = {
      status,
      code: body.code,
      method: request.method,
      url: request.originalUrl,
    };
    if (status >= 500) {
      this.logger.error({ ...logPayload, err: exception }, 'Yêu cầu thất bại');
    } else {
      this.logger.warn(logPayload, 'Yêu cầu bị từ chối');
    }

    response.status(status).json(body);
  }

  private toErrorResponse(exception: unknown): ErrorResponse {
    if (exception instanceof ThrottlerException) {
      return {
        status: HttpStatus.TOO_MANY_REQUESTS,
        body: {
          code: 'RATE_LIMITED',
          message: 'Bạn thao tác quá nhanh, vui lòng thử lại sau',
        },
      };
    }

    if (!(exception instanceof HttpException)) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        body: {
          code: 'INTERNAL_ERROR',
          message: 'Lỗi hệ thống, vui lòng thử lại sau',
        },
      };
    }

    const status = exception.getStatus();
    const payload = exception.getResponse();

    if (typeof payload === 'string') {
      return { status, body: { code: statusToCode(status), message: payload } };
    }

    const record = payload as Record<string, unknown>;
    if (typeof record.code === 'string' && typeof record.message === 'string') {
      const body: ErrorBody = { code: record.code, message: record.message };
      if (record.details !== undefined) {
        body.details = record.details;
      }
      return { status, body };
    }

    const rawMessage = record.message;
    if (Array.isArray(rawMessage)) {
      return {
        status,
        body: {
          code: 'VALIDATION_FAILED',
          message: 'Dữ liệu đầu vào không hợp lệ',
          details: rawMessage,
        },
      };
    }
    if (typeof rawMessage === 'string') {
      return {
        status,
        body: { code: statusToCode(status), message: rawMessage },
      };
    }

    return {
      status,
      body: { code: statusToCode(status), message: exception.message },
    };
  }
}

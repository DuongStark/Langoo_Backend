import { BadRequestException, HttpStatus } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { ArgumentsHost } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { DomainException } from '../errors/domain.exception';

interface ResponseMock {
  status: jest.Mock;
  json: jest.Mock;
}

interface LoggerMock {
  setContext: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
}

function createFilter(): {
  filter: AllExceptionsFilter;
  logger: LoggerMock;
} {
  const logger: LoggerMock = {
    setContext: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const filter = new AllExceptionsFilter(logger as unknown as PinoLogger);
  return { filter, logger };
}

function createContext(): { host: ArgumentsHost; response: ResponseMock } {
  const response: ResponseMock = { status: jest.fn(), json: jest.fn() };
  response.status.mockReturnValue(response);
  const request = { method: 'GET', originalUrl: '/v1/test' };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request as Request,
      getResponse: () => response as unknown as Response,
    }),
  } as unknown as ArgumentsHost;
  return { host, response };
}

describe('AllExceptionsFilter', () => {
  it('DomainException giữ nguyên code/message/details và HTTP status', () => {
    const { filter } = createFilter();
    const { host, response } = createContext();

    filter.catch(
      new DomainException(
        'SRS_ITEM_NOT_DUE',
        'Thẻ chưa đến hạn ôn',
        HttpStatus.UNPROCESSABLE_ENTITY,
        { due_at: '2026-10-01T00:00:00.000Z' },
      ),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(422);
    expect(response.json).toHaveBeenCalledWith({
      code: 'SRS_ITEM_NOT_DUE',
      message: 'Thẻ chưa đến hạn ôn',
      details: { due_at: '2026-10-01T00:00:00.000Z' },
    });
  });

  it('HttpException dạng chuỗi (ví dụ NotFoundException mặc định) → code theo status', () => {
    const { filter } = createFilter();
    const { host, response } = createContext();

    filter.catch(new BadRequestException(), host);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      code: 'BAD_REQUEST',
      message: 'Bad Request',
    });
  });

  it('lỗi validate của ValidationPipe → VALIDATION_FAILED kèm details', () => {
    const { filter } = createFilter();
    const { host, response } = createContext();

    filter.catch(
      new BadRequestException({
        statusCode: 400,
        message: ['email must be an email'],
        error: 'Bad Request',
      }),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      code: 'VALIDATION_FAILED',
      message: 'Dữ liệu đầu vào không hợp lệ',
      details: ['email must be an email'],
    });
  });

  it('ThrottlerException → 429 RATE_LIMITED với message thống nhất', () => {
    const { filter } = createFilter();
    const { host, response } = createContext();

    filter.catch(new ThrottlerException(), host);

    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.json).toHaveBeenCalledWith({
      code: 'RATE_LIMITED',
      message: 'Bạn thao tác quá nhanh, vui lòng thử lại sau',
    });
  });

  it('lỗi không xác định → 500 INTERNAL_ERROR, không lộ chi tiết gốc', () => {
    const { filter, logger } = createFilter();
    const { host, response } = createContext();

    filter.catch(new Error('chi tiết nội bộ: bảng app.users'), host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      code: 'INTERNAL_ERROR',
      message: 'Lỗi hệ thống, vui lòng thử lại sau',
    });
    expect(logger.error).toHaveBeenCalled();
    const jsonCalls = response.json.mock.calls as unknown[][];
    expect(JSON.stringify(jsonCalls)).not.toContain('app.users');
  });
});

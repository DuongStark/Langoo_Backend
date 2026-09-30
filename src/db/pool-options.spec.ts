import { ConfigService } from '@nestjs/config';
import { pgPoolTuning } from './pool-options';

function configWith(values: Record<string, string | number | undefined>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('pgPoolTuning', () => {
  it('trả mặc định khi chưa cấu hình', () => {
    expect(pgPoolTuning(configWith({}))).toEqual({
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  });

  it('đọc được giá trị dạng chuỗi từ env', () => {
    expect(
      pgPoolTuning(
        configWith({
          DB_POOL_MAX: '25',
          DB_POOL_IDLE_TIMEOUT_MS: '60000',
          DB_POOL_CONNECTION_TIMEOUT_MS: '5000',
        }),
      ),
    ).toEqual({
      max: 25,
      idleTimeoutMillis: 60_000,
      connectionTimeoutMillis: 5_000,
    });
  });

  it('kẹp giá trị ngoài biên và bỏ qua giá trị rác', () => {
    expect(
      pgPoolTuning(
        configWith({
          DB_POOL_MAX: '999',
          DB_POOL_IDLE_TIMEOUT_MS: 'khong-phai-so',
        }),
      ),
    ).toEqual({
      max: 100,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  });
});

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { DomainException } from '../common/errors/domain.exception';
import { PG_POOL } from '../db/pg-pool.provider';
import { HealthResponseDto } from './dto/health-response.dto';

@Injectable()
export class HealthService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async check(): Promise<HealthResponseDto> {
    const startedAt = Date.now();
    try {
      await this.pool.query('SELECT 1 AS ok');
    } catch {
      throw new DomainException(
        'DB_UNAVAILABLE',
        'Không kết nối được cơ sở dữ liệu',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return {
      status: 'ok',
      db: 'ok',
      db_latency_ms: Date.now() - startedAt,
      uptime_s: Math.round(process.uptime()),
      time: new Date().toISOString(),
    };
  }
}

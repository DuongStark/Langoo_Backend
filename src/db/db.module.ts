import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL, pgPoolProvider } from './pg-pool.provider';
import { LanguageRepository } from './repositories/language.repository';

@Global()
@Module({
  providers: [pgPoolProvider, LanguageRepository],
  exports: [PG_POOL, LanguageRepository],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

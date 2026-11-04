import { TermsController } from './terms.controller';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../db/prisma.module';
import {
  AdminPrivacyController,
  LegalController,
  PrivacyController,
} from './privacy.controller';
import { PrivacyService } from './privacy.service';
@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [
    TermsController,
    LegalController,
    PrivacyController,
    AdminPrivacyController,
  ],
  providers: [PrivacyService],
  exports: [PrivacyService],
})
export class PrivacyModule {}

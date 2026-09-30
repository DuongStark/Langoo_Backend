import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminAuditService } from './admin-audit.service';
import { AdminGlossReportsService } from './admin-gloss-reports.service';
import { AdminStatsService } from './admin-stats.service';
import { AdminUsersService } from './admin-users.service';
import {
  AdminAuditController,
  AdminGlossReportsController,
  AdminStatsController,
  AdminUsersController,
} from './admin.controller';

/**
 * Module admin (M13): thống kê tổng hợp, xử lý gloss_report, khoá/mở user, audit log.
 * Không truy cập nội dung cá nhân (collection/item/chat).
 */
@Module({
  imports: [AuthModule],
  controllers: [
    AdminStatsController,
    AdminGlossReportsController,
    AdminUsersController,
    AdminAuditController,
  ],
  providers: [
    AdminStatsService,
    AdminGlossReportsService,
    AdminUsersService,
    AdminAuditService,
  ],
  exports: [AdminAuditService],
})
export class AdminModule {}

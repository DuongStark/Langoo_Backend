import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/**
 * Module người dùng: hồ sơ học (study_profile) + cài đặt (user_settings).
 * LanguageRepository do DbModule (global) cung cấp.
 */
@Module({
  imports: [AuthModule],
  controllers: [ProfileController, SettingsController],
  providers: [ProfileService, SettingsService],
  exports: [ProfileService, SettingsService],
})
export class UsersModule {}

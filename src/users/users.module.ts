import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LanguageRepository } from './language.repository';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/**
 * Module người dùng: hồ sơ học (study_profile) + cài đặt (user_settings).
 */
@Module({
  imports: [AuthModule],
  controllers: [ProfileController, SettingsController],
  providers: [ProfileService, SettingsService, LanguageRepository],
  exports: [ProfileService, SettingsService, LanguageRepository],
})
export class UsersModule {}

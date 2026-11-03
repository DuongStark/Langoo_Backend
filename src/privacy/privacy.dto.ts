import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export const PRIVACY_PURPOSES = [
  'ai_assistance',
  'online_translation',
  'analytics',
] as const;
export const PRIVACY_RIGHTS = [
  'access',
  'rectification',
  'erasure',
  'restriction',
  'objection',
] as const;
export class PrivacyEventInput {
  @ApiProperty({ enum: PRIVACY_PURPOSES })
  @IsIn(PRIVACY_PURPOSES)
  purpose_id!: string;
  @ApiProperty({ enum: ['grant', 'withdraw'] })
  @IsIn(['grant', 'withdraw'])
  action!: string;
  @ApiProperty({ type: String, minLength: 1, maxLength: 80 })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  notice_version!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  request_id!: string;
}
export class PrivacyRequestInput {
  @ApiProperty({ enum: PRIVACY_RIGHTS })
  @IsIn(PRIVACY_RIGHTS)
  kind!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  request_id!: string;
}
export class UpdatePrivacyRequestInput {
  @ApiProperty({ enum: ['in_progress', 'rejected'] })
  @IsIn(['in_progress', 'rejected'])
  status!: string;
  @ApiPropertyOptional({
    type: String,
    enum: ['identity_unverified', 'outside_scope', 'duplicate'],
  })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsIn(['identity_unverified', 'outside_scope', 'duplicate'])
  rejection_reason?: string;
}
export class PrivacyListQuery {
  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    description: 'Opaque request ID cursor, lexicographic UUID order',
  })
  @IsOptional()
  @IsUUID()
  cursor?: string;
}
export class PrivacyEventResponse {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) request_id!: string;
  @ApiProperty({ enum: PRIVACY_PURPOSES }) purpose_id!: string;
  @ApiProperty({ enum: ['grant', 'withdraw'] }) action!: string;
  @ApiProperty({ type: String }) notice_version!: string;
  @ApiProperty({ type: String, format: 'date-time' }) created_at!: string;
}
export class PrivacyChoiceResponse {
  @ApiProperty({ enum: PRIVACY_PURPOSES }) purpose_id!: string;
  @ApiProperty({ enum: ['granted', 'withdrawn', 'needs_action'] })
  state!: string;
}
export class PrivacyStateResponse {
  @ApiProperty({ type: String }) notice_version!: string;
  @ApiProperty({ type: Boolean }) ai_consent_required!: boolean;
  @ApiProperty({ type: [PrivacyChoiceResponse] })
  choices!: PrivacyChoiceResponse[];
}
export class PrivacyRequestResponse {
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  resolution_reference!: string | null;
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) request_id!: string;
  @ApiProperty({ enum: PRIVACY_RIGHTS }) kind!: string;
  @ApiProperty({ enum: ['received', 'in_progress', 'rejected', 'completed'] })
  status!: string;
  @ApiProperty({ type: String, format: 'date-time' }) received_at!: string;
  @ApiProperty({ type: String, format: 'date-time' }) acknowledged_at!: string;
  @ApiProperty({
    type: String,
    format: 'date-time',
    description:
      'Base execution target; does not represent completion or an approved extension',
  })
  target_at!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updated_at!: string;
  @ApiProperty({ type: String, nullable: true }) rejection_reason!:
    string | null;
}
export class PrivacyRequestListResponse {
  @ApiProperty({ type: [PrivacyRequestResponse] })
  data!: PrivacyRequestResponse[];
  @ApiProperty({ type: String, nullable: true }) next_cursor!: string | null;
}
export class AgePolicyResponse {
  @ApiProperty({ type: Number, nullable: true, example: null })
  minimum_age!: null;
  @ApiProperty({ type: String, example: 'not_implemented' })
  representative_verification!: string;
}
export class LegalPurposeResponse {
  @ApiProperty({ enum: PRIVACY_PURPOSES }) purpose_id!: string;
  @ApiProperty({ type: String }) description_vi!: string;
}
export class LegalManifestResponse {
  @ApiProperty({ type: String }) notice_version!: string;
  @ApiProperty({
    type: String,
    description:
      'Technical consent notice URL; UI must publish this version before collecting grants',
  })
  notice_url!: string;
  @ApiProperty({ type: Boolean }) ai_consent_required!: boolean;
  @ApiProperty({ type: AgePolicyResponse }) age_policy!: AgePolicyResponse;
  @ApiProperty({ type: [LegalPurposeResponse] })
  purposes!: LegalPurposeResponse[];
  @ApiProperty({ type: String }) rights_contact_email!: string;
}

export class AdminPrivacyRequestResponse extends PrivacyRequestResponse {
  @ApiProperty({ type: String, description: 'Internal owner ID; admin-only' })
  user_id!: string;
}
export class AdminPrivacyRequestListResponse {
  @ApiProperty({ type: [AdminPrivacyRequestResponse] })
  data!: AdminPrivacyRequestResponse[];
  @ApiProperty({ type: String, nullable: true }) next_cursor!: string | null;
}

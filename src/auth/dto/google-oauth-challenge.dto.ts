import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export const GOOGLE_OAUTH_CHALLENGE_PURPOSES = ['login', 'link'] as const;
export type GoogleOAuthChallengePurpose =
  (typeof GOOGLE_OAUTH_CHALLENGE_PURPOSES)[number];

export class GoogleOAuthChallengeDto {
  @ApiProperty({ enum: GOOGLE_OAUTH_CHALLENGE_PURPOSES })
  @IsIn(GOOGLE_OAUTH_CHALLENGE_PURPOSES)
  purpose!: GoogleOAuthChallengePurpose;
}

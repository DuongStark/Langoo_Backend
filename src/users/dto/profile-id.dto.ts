import { IsUUID } from 'class-validator';

export class ProfileIdDto {
  @IsUUID()
  id!: string;
}

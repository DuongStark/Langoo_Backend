import { ApiProperty } from '@nestjs/swagger';

export class ImageContractDto {
  @ApiProperty({
    type: String,
    example:
      'https://media.langoo.org/illustrations/muse-ordinary-auto-v2/4733a53dfde670692dfcffe0518b939011eeaf8e9cd54bb819228181e26a0c65.png',
    description: 'URL công khai của ảnh minh họa được phê duyệt',
  })
  url!: string;

  @ApiProperty({
    type: String,
    example: 'image/png',
    description:
      'MIME type của ảnh (image/png, image/jpeg, image/webp, image/avif)',
  })
  mime!: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 512,
    description:
      'Chiều rộng ảnh tính bằng pixel (null nếu thiếu hoặc không hợp lệ)',
  })
  width!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 512,
    description:
      'Chiều cao ảnh tính bằng pixel (null nếu thiếu hoặc không hợp lệ)',
  })
  height!: number | null;
}

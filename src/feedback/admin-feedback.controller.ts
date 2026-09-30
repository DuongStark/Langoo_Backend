import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdminGuard } from '../auth/guards/admin.guard';
import { JwtPayload } from '../auth/types/auth.types';
import { parseUuidParam } from '../common/ids/postgres-id';
import { AdminFeedbackQueryDto, UpdateFeedbackDto } from './dto/feedback.dto';
import { FeedbackService } from './feedback.service';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/feedback')
export class AdminFeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Get()
  @ApiOperation({
    summary: 'Hàng chờ feedback (lọc status/category, keyset cursor)',
    description:
      'Dữ liệu do user chủ động gửi — ngoại lệ duy nhất admin được xem chi tiết.',
  })
  @ApiOkResponse({ description: '{ data, next_cursor }' })
  list(@Query() query: AdminFeedbackQueryDto) {
    return this.feedbackService.adminList(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết feedback + metadata ảnh + user gửi' })
  get(@Param('id') id: string) {
    return this.feedbackService.adminGet(parseUuidParam(id, 'ID feedback'));
  }

  @Get(':id/attachments/:attachmentId')
  @ApiOperation({
    summary: 'Tải ảnh feedback (guard admin; không có public URL)',
  })
  async attachment(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, mime } = await this.feedbackService.getAttachment(
      parseUuidParam(id, 'ID feedback'),
      parseUuidParam(attachmentId, 'ID ảnh'),
    );
    res.set({
      'Content-Type': mime,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'private, max-age=300',
    });
    return new StreamableFile(buffer);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Cập nhật trạng thái/ghi chú feedback (audit trong cùng transaction)',
  })
  update(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateFeedbackDto,
  ) {
    return this.feedbackService.adminUpdate(
      BigInt(payload.sub),
      parseUuidParam(id, 'ID feedback'),
      dto,
    );
  }
}

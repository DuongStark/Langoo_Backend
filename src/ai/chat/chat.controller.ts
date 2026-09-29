import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../../auth/types/auth.types';
import { parseUuidParam } from '../../common/ids/postgres-id';
import { ChatService } from './chat.service';
import {
  ChatListQueryDto,
  CreateChatSessionDto,
  SendChatMessageDto,
  UpdateChatSessionDto,
} from './dto/chat.dto';
import {
  ChatMessageListResponse,
  ChatSessionListResponse,
  ChatSessionResponse,
  ChatUsageResponse,
  SendChatMessageResponse,
} from './types/chat.types';

@ApiTags('chat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('sessions')
  @ApiOperation({
    summary: 'Tạo phiên chat AI',
    description:
      'scenario: general | vocabulary | grammar | conversation. ' +
      'Ví dụ curl: docs/api/chat.md',
  })
  @ApiCreatedResponse({ description: 'Phiên chat vừa tạo' })
  createSession(
    @CurrentUser() payload: JwtPayload,
    @Body() dto: CreateChatSessionDto,
  ): Promise<ChatSessionResponse> {
    return this.chatService.createSession(BigInt(payload.sub), dto);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Danh sách phiên chat (ẩn phiên đã lưu trữ)' })
  @ApiOkResponse({ description: '{ data, next_cursor }' })
  listSessions(
    @CurrentUser() payload: JwtPayload,
    @Query() query: ChatListQueryDto,
  ): Promise<ChatSessionListResponse> {
    return this.chatService.listSessions(BigInt(payload.sub), query);
  }

  @Get('sessions/:id')
  @ApiOperation({ summary: 'Chi tiết phiên chat' })
  getSession(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
  ): Promise<ChatSessionResponse> {
    return this.chatService.getSession(
      BigInt(payload.sub),
      parseUuidParam(id, 'ID phiên chat'),
    );
  }

  @Patch('sessions/:id')
  @ApiOperation({ summary: 'Đổi tên/kịch bản phiên chat' })
  updateSession(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateChatSessionDto,
  ): Promise<ChatSessionResponse> {
    return this.chatService.updateSession(
      BigInt(payload.sub),
      parseUuidParam(id, 'ID phiên chat'),
      dto,
    );
  }

  @Delete('sessions/:id')
  @ApiOperation({ summary: 'Lưu trữ phiên chat (archive mềm, idempotent)' })
  archiveSession(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
  ): Promise<ChatSessionResponse> {
    return this.chatService.archiveSession(
      BigInt(payload.sub),
      parseUuidParam(id, 'ID phiên chat'),
    );
  }

  @Get('sessions/:id/messages')
  @ApiOperation({ summary: 'Lịch sử tin nhắn (tăng dần theo thời gian)' })
  listMessages(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
    @Query() query: ChatListQueryDto,
  ): Promise<ChatMessageListResponse> {
    return this.chatService.listMessages(
      BigInt(payload.sub),
      parseUuidParam(id, 'ID phiên chat'),
      query,
    );
  }

  @Post('sessions/:id/messages')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Gửi tin nhắn, nhận trả lời từ trợ lý AI',
    description:
      'Trừ quota ngày (AI_DAILY_REQUEST_LIMIT, mặc định 50); ' +
      'ref_sense_id để đính kèm ngữ cảnh nghĩa từ điển.',
  })
  @ApiOkResponse({ description: '{ user_message, assistant_message, usage }' })
  sendMessage(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
    @Body() dto: SendChatMessageDto,
  ): Promise<SendChatMessageResponse> {
    return this.chatService.sendMessage(
      BigInt(payload.sub),
      parseUuidParam(id, 'ID phiên chat'),
      dto,
    );
  }

  @Get('usage')
  @ApiOperation({ summary: 'Quota chat đã dùng hôm nay (theo timezone user)' })
  getUsage(@CurrentUser() payload: JwtPayload): Promise<ChatUsageResponse> {
    return this.chatService.getUsage(BigInt(payload.sub));
  }
}

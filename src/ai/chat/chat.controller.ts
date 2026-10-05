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
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../../auth/types/auth.types';
import { parseUuidParam } from '../../common/ids/postgres-id';
import { DomainException } from '../../common/errors/domain.exception';
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

  @Post('sessions/:id/messages/stream')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Gửi tin nhắn, nhận trả lời dần qua SSE (M10.1)',
    description:
      'Sự kiện: start → delta* → done (hoặc error). Dùng chung quota/lease với endpoint thường; ' +
      'khi stream lỗi giữa chừng sẽ có event error thay vì HTTP 503.',
  })
  @ApiProduces('text/event-stream')
  async streamMessage(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
    @Body() dto: SendChatMessageDto,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const abort = new AbortController();
    const onClose = (): void => {
      if (!response.writableEnded) {
        abort.abort();
      }
    };
    response.once('close', onClose);
    if (request.aborted || response.destroyed) abort.abort();

    let headersSent = false;
    const write = (chunk: string): void => {
      abort.signal.throwIfAborted();
      if (response.destroyed || response.writableEnded) {
        abort.abort();
        abort.signal.throwIfAborted();
      }
      if (!headersSent) {
        response.writeHead(HttpStatus.OK, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        headersSent = true;
      }
      response.write(chunk);
    };
    const writeEvent = (name: string, data: unknown): void => {
      write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const heartbeat = setInterval(() => {
      if (headersSent && !response.writableEnded && !response.destroyed) {
        response.write(': ping\n\n');
      }
    }, 15_000);

    try {
      await this.chatService.sendMessageStream(
        BigInt(payload.sub),
        parseUuidParam(id, 'ID phiên chat'),
        dto,
        (event) => {
          if (event.type === 'delta') {
            writeEvent('delta', { content: event.content });
          } else if (event.type === 'done') {
            writeEvent('done', event.response);
          } else if (event.type === 'error') {
            writeEvent('error', {
              code: event.code,
              message: event.message,
            });
          } else {
            writeEvent('start', { model: event.model });
          }
        },
        abort.signal,
      );
    } catch (error) {
      // The client is gone; neither JSON nor SSE can be delivered any more.
      if (abort.signal.aborted || response.destroyed) return;
      if (!headersSent) throw error;
      const payload =
        error instanceof DomainException
          ? (error.getResponse() as { code: string; message: string })
          : {
              code: 'CHAT_STREAM_FAILED',
              message: 'Không hoàn tất được lượt chat, vui lòng thử lại sau',
            };
      writeEvent('error', payload);
    } finally {
      clearInterval(heartbeat);
      response.off('close', onClose);
      if (headersSent && !response.writableEnded && !response.destroyed) {
        response.end();
      }
    }
  }

  @Get('usage')
  @ApiOperation({ summary: 'Quota chat đã dùng hôm nay (theo timezone user)' })
  getUsage(@CurrentUser() payload: JwtPayload): Promise<ChatUsageResponse> {
    return this.chatService.getUsage(BigInt(payload.sub));
  }
}

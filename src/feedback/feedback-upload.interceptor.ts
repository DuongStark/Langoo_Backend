import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { DomainException } from '../common/errors/domain.exception';
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
} from '../storage/storage.service';

const UploadInterceptor = FilesInterceptor('files', MAX_ATTACHMENTS, {
  limits: { fileSize: MAX_ATTACHMENT_BYTES },
});

/** Keep multipart failures on the feedback API's documented error contract. */
@Injectable()
export class FeedbackUploadInterceptor implements NestInterceptor {
  private readonly upload = new UploadInterceptor();

  async intercept(context: ExecutionContext, next: CallHandler) {
    try {
      return await this.upload.intercept(context, next);
    } catch (error) {
      if (error instanceof PayloadTooLargeException) {
        throw new DomainException(
          'PAYLOAD_TOO_LARGE',
          'Ảnh vượt quá 5MB',
          HttpStatus.PAYLOAD_TOO_LARGE,
        );
      }
      if (error instanceof BadRequestException) {
        throw new DomainException(
          'ATTACHMENT_INVALID',
          'Tệp đính kèm không hợp lệ (tối đa 3 ảnh trong field files)',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }
}

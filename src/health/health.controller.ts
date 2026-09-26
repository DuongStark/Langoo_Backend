import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/swagger/error-response.dto';
import { HealthResponseDto } from './dto/health-response.dto';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Kiểm tra API và kết nối cơ sở dữ liệu' })
  @ApiOkResponse({
    type: HealthResponseDto,
    description: 'API và DB hoạt động bình thường',
  })
  @ApiServiceUnavailableResponse({
    type: ErrorResponseDto,
    description: 'Không kết nối được DB (code: DB_UNAVAILABLE)',
  })
  check(): Promise<HealthResponseDto> {
    return this.healthService.check();
  }
}

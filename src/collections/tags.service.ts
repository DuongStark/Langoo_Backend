import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException } from '../common/errors/domain.exception';
import { PrismaService } from '../db/prisma.service';
import { CreateTagDto } from './dto/create-tag.dto';
import {
  DeletedResponse,
  TagListResult,
  TagResponse,
} from './types/collections.types';

interface TagRow {
  id: bigint;
  name: string;
  color: string | null;
  createdAt: Date;
}

/** Tag là tài nguyên user-scoped (`app.tag`), dùng để gắn vào item. */
@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: bigint): Promise<TagListResult> {
    const rows = await this.prisma.tag.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
    });
    return { data: rows.map(toTagResponse), next_cursor: null };
  }

  async create(userId: bigint, dto: CreateTagDto): Promise<TagResponse> {
    const name = dto.name.trim();
    const existing = await this.prisma.tag.findFirst({
      where: { userId, name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) {
      throw tagAlreadyExists();
    }

    try {
      const tag = await this.prisma.tag.create({
        data: { userId, name, color: dto.color ?? null },
      });
      return toTagResponse(tag);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw tagAlreadyExists();
      }
      throw error;
    }
  }

  async remove(userId: bigint, tagId: string): Promise<DeletedResponse> {
    const tag = await this.prisma.tag.findFirst({
      where: { id: BigInt(tagId), userId },
      select: { id: true },
    });
    if (!tag) {
      throw new DomainException(
        'TAG_NOT_FOUND',
        'Không tìm thấy tag',
        HttpStatus.NOT_FOUND,
      );
    }
    await this.prisma.tag.delete({ where: { id: tag.id } });
    return { id: tag.id.toString(), deleted_at: new Date().toISOString() };
  }
}

function tagAlreadyExists(): DomainException {
  return new DomainException(
    'TAG_ALREADY_EXISTS',
    'Tag này đã tồn tại',
    HttpStatus.CONFLICT,
  );
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

function toTagResponse(row: TagRow): TagResponse {
  return {
    id: row.id.toString(),
    name: row.name,
    color: row.color,
    created_at: row.createdAt.toISOString(),
  };
}

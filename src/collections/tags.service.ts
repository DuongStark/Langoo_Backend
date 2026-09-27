import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException } from '../common/errors/domain.exception';
import { parsePositivePostgresBigInt } from '../common/ids/postgres-id';
import { PrismaService } from '../db/prisma.service';
import { CreateTagDto } from './dto/create-tag.dto';
import { ListTagsQueryDto } from './dto/list-tags-query.dto';
import { decodeTagListCursor, encodeTagListCursor } from './list-cursors';
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

  async list(
    userId: bigint,
    query: ListTagsQueryDto = {},
  ): Promise<TagListResult> {
    const cursor =
      query.cursor === undefined
        ? undefined
        : decodeTagListCursor(query.cursor);
    const limit = query.limit ?? 20;
    const rows = await this.prisma.tag.findMany({
      where: {
        userId,
        ...(cursor
          ? {
              OR: [
                { name: { gt: cursor.name } },
                {
                  name: cursor.name,
                  id: { gt: parsePositivePostgresBigInt(cursor.id, 'tag_id') },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      data: page.map(toTagResponse),
      next_cursor:
        hasMore && last !== undefined
          ? encodeTagListCursor({ name: last.name, id: last.id.toString() })
          : null,
    };
  }

  async create(userId: bigint, dto: CreateTagDto): Promise<TagResponse> {
    const name = dto.name.trim();
    if (name.length === 0) {
      throw new DomainException(
        'VALIDATION_FAILED',
        'Tên tag không được để trống',
        HttpStatus.BAD_REQUEST,
      );
    }
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
    const id = parsePositivePostgresBigInt(tagId, 'tag_id');
    const deleted = await this.prisma.tag.deleteMany({
      where: { id, userId },
    });
    if (deleted.count === 0) {
      throw new DomainException(
        'TAG_NOT_FOUND',
        'Không tìm thấy tag',
        HttpStatus.NOT_FOUND,
      );
    }
    return { id: id.toString(), deleted_at: new Date().toISOString() };
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

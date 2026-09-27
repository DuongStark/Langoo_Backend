import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { Prisma } from '../../generated/prisma/client';

/**
 * Đọc metadata ngôn ngữ từ `public.language` (schema public KHÔNG map trong Prisma).
 * Chỉ đọc — không ghi vào public.
 */
@Injectable()
export class LanguageRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Tập id ngôn ngữ tồn tại trong public.language. */
  async findExistingIds(ids: number[]): Promise<Set<number>> {
    if (ids.length === 0) {
      return new Set();
    }
    const rows = await this.prisma.$queryRaw<{ id: number }[]>`
      SELECT id FROM public.language WHERE id IN (${Prisma.join(ids)})
    `;
    return new Set(rows.map((row) => row.id));
  }

  /** Id theo mã ngôn ngữ ('en' | 'ja' | 'vi' | 'zh-Hans'); null nếu không tồn tại. */
  async findIdByCode(code: string): Promise<number | null> {
    const rows = await this.prisma.$queryRaw<{ id: number }[]>`
      SELECT id FROM public.language WHERE code = ${code}
    `;
    return rows[0]?.id ?? null;
  }
}

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSourceDto } from './dto/source-response.dto';
import {
  SourceCountRow,
  SourceRow,
  SourcesRepository,
} from './sources.repository';

/** Credits ít đổi — cache trong process để tránh COUNT trên bảng lớn mỗi request. */
const CACHE_TTL_MS = 10 * 60 * 1000;

function toCountMap(rows: SourceCountRow[]): Map<number, number> {
  return new Map(
    rows
      .filter(
        (row): row is SourceCountRow & { source_id: number } =>
          row.source_id !== null,
      )
      .map((row) => [row.source_id, row.count]),
  );
}

function creditLine(row: SourceRow): string {
  const head = [row.name, row.attribution].filter((v): v is string => !!v);
  const base = head.join(' — ');
  return row.license ? `${base} · ${row.license}` : base;
}

@Injectable()
export class SourcesService implements OnModuleInit {
  private readonly logger = new Logger(SourcesService.name);
  private cache: { expiresAt: number; data: DataSourceDto[] } | null = null;

  constructor(private readonly repo: SourcesRepository) {}

  /** Warm cache nền lúc boot để request đầu không phải chờ COUNT bảng lớn. */
  onModuleInit(): void {
    void this.list().catch((error: unknown) => {
      this.logger.warn(
        `Không warm được cache sources: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  async list(): Promise<DataSourceDto[]> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) return this.cache.data;

    const [
      sources,
      lexemes,
      senses,
      glosses,
      concepts,
      conceptGlosses,
      kanji,
      examples,
    ] = await Promise.all([
      this.repo.listSources(),
      this.repo.countLexemes(),
      this.repo.countSenses(),
      this.repo.countGlosses(),
      this.repo.countConcepts(),
      this.repo.countConceptGlosses(),
      this.repo.countKanji(),
      this.repo.countExamples(),
    ]);

    const lexemeCounts = toCountMap(lexemes);
    const senseCounts = toCountMap(senses);
    const glossCounts = toCountMap(glosses);
    const conceptCounts = toCountMap(concepts);
    const conceptGlossCounts = toCountMap(conceptGlosses);
    const kanjiCounts = toCountMap(kanji);
    const exampleCounts = toCountMap(examples);

    const data: DataSourceDto[] = sources.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      license: row.license,
      attribution: row.attribution,
      url: row.url,
      version: row.version,
      credit_line: creditLine(row),
      usage: {
        lexemes: lexemeCounts.get(row.id) ?? 0,
        senses: senseCounts.get(row.id) ?? 0,
        glosses: glossCounts.get(row.id) ?? 0,
        concepts: conceptCounts.get(row.id) ?? 0,
        concept_glosses: conceptGlossCounts.get(row.id) ?? 0,
        kanji: kanjiCounts.get(row.id) ?? 0,
        examples: exampleCounts.get(row.id) ?? 0,
      },
    }));

    this.cache = { expiresAt: now + CACHE_TTL_MS, data };
    return data;
  }
}

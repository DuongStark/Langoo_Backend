import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSourceDto } from './dto/source-response.dto';
import {
  SourceCountRow,
  SourceRow,
  SourcesRepository,
} from './sources.repository';

/** Credits ít đổi — cache trong process để tránh COUNT trên bảng lớn mỗi request. */
const CACHE_TTL_MS = 10 * 60 * 1000;

/** DB3-B apply tạo 1 source/lô (`db3b-ai-<jobKey>`); gộp khi hiển thị credits. */
const MACHINE_SOURCE_PREFIX = 'db3b-ai-';

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
  private refreshInFlight: Promise<DataSourceDto[]> | null = null;

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
    if (this.cache && this.cache.expiresAt > now)
      return structuredClone(this.cache.data);
    if (this.refreshInFlight)
      return structuredClone(await this.refreshInFlight);
    const pending = this.refresh();
    this.refreshInFlight = pending;
    try {
      return structuredClone(await pending);
    } finally {
      if (this.refreshInFlight === pending) this.refreshInFlight = null;
    }
  }

  private async refresh(): Promise<DataSourceDto[]> {
    // A failed query must not release the shared refresh while its siblings still run.
    const results = await Promise.allSettled([
      this.repo.listSources(),
      this.repo.countLexemes(),
      this.repo.countSenses(),
      this.repo.countGlosses(),
      this.repo.countConcepts(),
      this.repo.countConceptGlosses(),
      this.repo.countKanji(),
      this.repo.countExamples(),
    ] as const);
    const sources = settledValue(results[0]);
    const lexemes = settledValue(results[1]);
    const senses = settledValue(results[2]);
    const glosses = settledValue(results[3]);
    const concepts = settledValue(results[4]);
    const conceptGlosses = settledValue(results[5]);
    const kanji = settledValue(results[6]);
    const examples = settledValue(results[7]);

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
      child_count: 1,
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

    const machineRows = data.filter((row) =>
      row.code.startsWith(MACHINE_SOURCE_PREFIX),
    );
    const grouped =
      machineRows.length === 0
        ? data
        : mergeMachineSources(
            data.filter((row) => !machineRows.includes(row)),
            machineRows,
          );

    this.cache = { expiresAt: Date.now() + CACHE_TTL_MS, data: grouped };
    return grouped;
  }
}

/**
 * Gộp các source `db3b-ai-*` (1 nguồn/lô apply) vào entry gloss-máy `llm-vi`:
 * cộng số gloss, tăng child_count; nếu chưa có `llm-vi` thì tạo entry tổng hợp.
 */
function mergeMachineSources(
  rest: DataSourceDto[],
  machineRows: DataSourceDto[],
): DataSourceDto[] {
  const glossCount = machineRows.reduce(
    (sum, row) => sum + row.usage.glosses,
    0,
  );
  const target = rest.find((row) => row.code === 'llm-vi');
  if (target) {
    target.usage.glosses += glossCount;
    target.child_count += machineRows.length;
    return rest;
  }
  return [
    ...rest,
    {
      id: 0,
      code: 'db3b-ai',
      name: 'DB3-B Vietnamese machine gloss',
      license: 'nội bộ',
      attribution: 'Machine translation; origin sense glosses',
      url: null,
      version: null,
      credit_line: 'DB3-B Vietnamese machine gloss · nội bộ',
      child_count: machineRows.length,
      usage: {
        lexemes: 0,
        senses: 0,
        glosses: glossCount,
        concepts: 0,
        concept_glosses: 0,
        kanji: 0,
        examples: 0,
      },
    },
  ];
}

function settledValue<T>(result: PromiseSettledResult<T>): T {
  if (result.status === 'rejected') throw result.reason;
  return result.value;
}

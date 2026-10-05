import {
  connect,
  dbNameOf,
  log,
  parseCli,
  requireUrl,
  writeManifest,
} from './_shared';

/**
 * DB3-A5 — audit credits/source (READ-ONLY, không ghi).
 * Liệt kê nguồn thiếu license/attribution/url/version và các license "CẦN XÁC MINH".
 * Việc sửa license là quyết định của chủ dự án (không tự đổi).
 */

async function main(): Promise<void> {
  const cli = parseCli('credits-audit', process.argv.slice(2));
  const url = requireUrl();
  const client = await connect(url);
  try {
    const sources = await client.query<{
      id: number;
      code: string;
      name: string;
      license: string | null;
      attribution: string | null;
      url: string | null;
      version: string | null;
    }>(
      'SELECT id, code, name, license, attribution, url, version FROM public.source ORDER BY id',
    );

    const missingLicense = sources.rows.filter((row) => !row.license);
    const missingAttribution = sources.rows.filter((row) => !row.attribution);
    const missingUrl = sources.rows.filter((row) => !row.url);
    const missingVersion = sources.rows.filter((row) => !row.version);
    const needVerify = sources.rows.filter((row) =>
      (row.license ?? '').toUpperCase().includes('CẦN XÁC MINH'),
    );

    log(`== DB3 credits-audit (READ-ONLY) — db=${dbNameOf(url)} ==`);
    log(`  tổng nguồn: ${sources.rows.length}`);
    log(
      `  thiếu license: ${missingLicense.length} | thiếu attribution: ${missingAttribution.length}`,
    );
    log(
      `  thiếu url: ${missingUrl.length} | thiếu version: ${missingVersion.length}`,
    );
    for (const row of needVerify) {
      log(
        `  ⚠ cần xác minh license: #${row.id} ${row.code} — "${row.license}"`,
      );
    }
    for (const row of missingVersion) {
      log(`  · thiếu version: #${row.id} ${row.code}`);
    }

    const manifestFile = writeManifest(cli.manifestDir, {
      task: 'credits-audit',
      startedAt: new Date().toISOString(),
      applied: false,
      db: dbNameOf(url),
      summary: {
        total: sources.rows.length,
        missingLicense: missingLicense.map((row) => row.code),
        missingAttribution: missingAttribution.map((row) => row.code),
        missingUrl: missingUrl.map((row) => row.code),
        missingVersion: missingVersion.map((row) => row.code),
        needVerify: needVerify.map((row) => ({
          code: row.code,
          license: row.license,
        })),
      },
      warnings: needVerify.map((row) => `${row.code}: license cần xác minh`),
    });
    log(`manifest: ${manifestFile}`);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(
      `credits-audit: LỖI — ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}

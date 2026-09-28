import { loadScriptEnv, logError, requireEnv } from './_shared';
import { applyPendingMigrations } from './migrations';

const SCRIPT = 'db:migrate';

async function main(): Promise<void> {
  loadScriptEnv();
  const directUrl = requireEnv('DIRECT_URL');

  const uptoIndex = process.argv.indexOf('--upto');
  let options = {};
  if (uptoIndex !== -1) {
    const upto = process.argv[uptoIndex + 1];
    if (upto === undefined || !/^\d{3}$/.test(upto)) {
      throw new Error('--upto cần số 3 chữ số, ví dụ: --upto 027');
    }
    options = { upto };
  }

  await applyPendingMigrations(directUrl, SCRIPT, options);
}

main().catch((error: unknown) => {
  logError(SCRIPT, error);
  process.exitCode = 1;
});

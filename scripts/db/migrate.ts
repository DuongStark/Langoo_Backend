import { loadScriptEnv, logError, requireEnv } from './_shared';
import { applyPendingMigrations } from './migrations';

const SCRIPT = 'db:migrate';

async function main(): Promise<void> {
  loadScriptEnv();
  const directUrl = requireEnv('DIRECT_URL');
  await applyPendingMigrations(directUrl, SCRIPT);
}

main().catch((error: unknown) => {
  logError(SCRIPT, error);
  process.exitCode = 1;
});

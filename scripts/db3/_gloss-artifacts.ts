import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { saveJournal } from './_mutations';

export function artifactHash(text: string | Buffer): string {
  return createHash('sha256').update(text).digest('hex');
}
export function resolveArtifactPath(root: string, relative: string): string {
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative.includes('\\') ||
    relative.split('/').some((p) => !p || p === '.' || p === '..')
  )
    throw new Error('Artifact path must stay inside artifact-dir');
  const base = path.resolve(root);
  if (existsSync(base) && lstatSync(base).isSymbolicLink())
    throw new Error('Artifact root cannot be symlink');
  const destination = path.resolve(base, relative);
  for (
    let current = destination;
    current !== path.dirname(base);
    current = path.dirname(current)
  ) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink())
      throw new Error('Symlink in artifact path');
    if (current === path.dirname(current)) break;
  }
  if (existsSync(base) && !realpathSync(base).startsWith(base))
    throw new Error('Artifact root resolves elsewhere');
  return destination;
}
export function readArtifactText(
  root: string,
  relative: string,
  expectedHash?: string,
): string {
  const file = resolveArtifactPath(root, relative);
  const info = lstatSync(file);
  if (!info.isFile() || info.size > 256 * 1024 * 1024)
    throw new Error('Artifact is not a bounded regular file');
  const content = readFileSync(file);
  if (expectedHash !== undefined && artifactHash(content) !== expectedHash)
    throw new Error('Artifact hash mismatch');
  return content.toString('utf8');
}
export function readArtifactJson(
  root: string,
  relative: string,
  expectedHash?: string,
): unknown {
  return JSON.parse(readArtifactText(root, relative, expectedHash)) as unknown;
}
export function writeArtifactJson(
  root: string,
  relative: string,
  data: unknown,
): { path: string; sha256: string } {
  mkdirSync(path.resolve(root), { recursive: true, mode: 0o700 });
  const file = resolveArtifactPath(root, relative);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  resolveArtifactPath(root, relative);
  saveJournal(file, data);
  return { path: relative, sha256: artifactHash(readFileSync(file)) };
}
export async function withArtifactLock<T>(
  root: string,
  name: string,
  action: () => Promise<T>,
): Promise<T> {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid lock name');
  mkdirSync(path.resolve(root), { recursive: true, mode: 0o700 });
  const file = resolveArtifactPath(root, `${name}.lock`);
  let fd: number;
  try {
    fd = openSync(file, 'wx', 0o600);
  } catch {
    throw new Error(
      'Artifact job is locked; inspect stale lock manually before recovery',
    );
  }
  try {
    writeFileSync(
      fd,
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );
    return await action();
  } finally {
    closeSync(fd);
    unlinkSync(file);
  }
}

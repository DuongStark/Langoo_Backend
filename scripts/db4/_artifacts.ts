import { createHash } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';
import {
  ArtifactPath,
  ArtifactRefSchema,
  type ArtifactRef,
  canonicalJson,
} from './_mapping-types';

/** D2/D4 artifact I/O: containment, atomic write/fsync, SHA256 bytes, streaming JSONL. Owner: DeepSeek. */

export function sha256Bytes(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function sha256File(abs: string): string {
  const fd = openSync(abs, 'r');
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1 << 20);
  try {
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, null);
      if (read <= 0) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

/** Resolve a relative artifact path under root; reject traversal/absolute escapes. */
export function resolveArtifact(root: string, rel: string): string {
  const parsed = ArtifactPath.parse(rel);
  const abs = path.resolve(root, parsed);
  const relative = path.relative(root, abs);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error(`Artifact path escapes root: ${rel}`);
  return abs;
}

export function fsyncDir(absDir: string): void {
  const fd = openSync(absDir, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function writeTextAtomic(
  root: string,
  rel: string,
  text: string,
): ArtifactRef {
  const abs = resolveArtifact(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}`;
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, abs);
  fsyncDir(path.dirname(abs));
  return ArtifactRefSchema.parse({ path: rel, sha256: sha256Bytes(text) });
}

/** Canonical (sorted keys) pretty JSON with trailing newline; validates lossless JSON first. */
export function stablePretty(value: unknown): string {
  canonicalJson(value);
  const walk = (v: unknown, indent: string): string => {
    if (Array.isArray(v))
      return v.length
        ? `[\n${v.map((x) => `${indent}  ${walk(x, `${indent}  `)}`).join(',\n')}\n${indent}]`
        : '[]';
    if (v !== null && typeof v === 'object') {
      const entries = Object.entries(v as Record<string, unknown>).sort(
        ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
      );
      return entries.length
        ? `{\n${entries
            .map(
              ([k, x]) =>
                `${indent}  ${JSON.stringify(k)}: ${walk(x, `${indent}  `)}`,
            )
            .join(',\n')}\n${indent}}`
        : '{}';
    }
    return JSON.stringify(v);
  };
  return `${walk(value, '')}\n`;
}

export interface WrittenFile {
  ref: ArtifactRef;
  count: number;
}

/** Append-only canonical-JSONL writer with byte hashing; fsync on close. */
export class JsonlWriter {
  private readonly hash = createHash('sha256');
  private readonly fd: number;
  private readonly abs: string;
  private count = 0;
  private closed = false;

  constructor(
    private readonly root: string,
    private readonly rel: string,
  ) {
    this.abs = resolveArtifact(root, rel);
    mkdirSync(path.dirname(this.abs), { recursive: true });
    this.fd = openSync(this.abs, 'w');
  }

  get written(): number {
    return this.count;
  }

  write(value: unknown): void {
    if (this.closed) throw new Error('JsonlWriter already closed');
    const line = `${canonicalJson(value)}\n`;
    writeSync(this.fd, line);
    this.hash.update(line, 'utf8');
    this.count += 1;
  }

  close(): WrittenFile {
    if (this.closed) throw new Error('JsonlWriter already closed');
    this.closed = true;
    fsyncSync(this.fd);
    closeSync(this.fd);
    return {
      ref: ArtifactRefSchema.parse({
        path: this.rel,
        sha256: this.hash.digest('hex'),
      }),
      count: this.count,
    };
  }
}

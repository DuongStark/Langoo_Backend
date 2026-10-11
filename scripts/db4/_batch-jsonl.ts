// DB4-D4/D5: bounded JSONL scan. Callers publish manifests only after hash verification.
import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { z } from 'zod';
import { ArtifactRef, ArtifactRefSchema } from './_mapping-types';
import { artifactPath } from './_retrieval';

export async function scanBatchJsonl<T>(
  root: string,
  refValue: ArtifactRef,
  schema: z.ZodType<T>,
  label: string,
  visit: (row: T, line: number) => void | Promise<void>,
  cap = 64 * 1024 * 1024,
): Promise<number> {
  const ref = ArtifactRefSchema.parse(refValue);
  const path = artifactPath(root, ref.path);
  if (statSync(path).size > cap) throw new Error(`${label} exceeds byte cap`);
  const digest = createHash('sha256');
  let pending: Buffer = Buffer.alloc(0);
  let count = 0;
  let total = 0;
  const rowCap = Math.min(cap, 16 * 1024 * 1024);
  for await (const value of createReadStream(path, {
    highWaterMark: 64 * 1024,
  })) {
    const chunk = value as Buffer;
    total += chunk.length;
    if (total > cap) throw new Error(`${label} exceeds byte cap`);
    digest.update(chunk);
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    let start = 0;
    while (true) {
      const end = pending.indexOf(0x0a, start);
      if (end < 0) break;
      const bytes = pending.subarray(start, end);
      if (!bytes.length || bytes.length > rowCap)
        throw new Error(`${label} contains an empty/oversized row`);
      if (bytes.at(-1) === 0x0d) throw new Error(`${label} must use LF`);
      await visit(
        schema.parse(JSON.parse(bytes.toString('utf8')) as unknown),
        ++count,
      );
      start = end + 1;
    }
    // Copy the unconsumed tail so it does not retain a much larger backing buffer.
    pending = Buffer.from(pending.subarray(start));
    if (pending.length > rowCap)
      throw new Error(`${label} contains an oversized row`);
  }
  if (digest.digest('hex') !== ref.sha256)
    throw new Error(`${label} hash mismatch`);
  if (pending.length) throw new Error(`${label} must end with LF`);
  return count;
}

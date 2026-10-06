import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { JsonlWriter, resolveArtifact } from './_artifacts';

/** D2 retrieval primitives: EN normalization/tokenization + bounded token postings. Owner: DeepSeek. */

export const RETRIEVAL_VERSION = 'db4-retrieval-v1';
export const NORMALIZER_VERSION = 'db4-normalize-v1';
export const TOKENIZER_VERSION = 'db4-en-token-v1';
export const INDEX_SHARDS = 64;

export function normalizeEn(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

const TOKEN_RE = /[a-z0-9]+(?:['-][a-z0-9]+)*/g;

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'been',
  'being',
  'but',
  'by',
  'for',
  'from',
  'had',
  'has',
  'have',
  'he',
  'her',
  'him',
  'his',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'me',
  'my',
  'no',
  'not',
  'of',
  'on',
  'one',
  'or',
  'our',
  'out',
  'she',
  'so',
  'than',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'to',
  'up',
  'was',
  'we',
  'were',
  'what',
  'when',
  'which',
  'who',
  'will',
  'with',
  'you',
  'your',
]);

export function tokenizeEn(text: string): string[] {
  const normalized = normalizeEn(text);
  const tokens: string[] = [];
  for (const match of normalized.matchAll(TOKEN_RE)) {
    const token = match[0];
    if (token.length >= 2 && !STOPWORDS.has(token)) tokens.push(token);
  }
  return tokens;
}

export function uniqueTokens(texts: string[]): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const text of texts)
    for (const token of tokenizeEn(text))
      if (!seen.has(token)) {
        seen.add(token);
        tokens.push(token);
      }
  return tokens;
}

export function shardIndex(token: string): number {
  return (
    Number.parseInt(
      createHash('sha256').update(token).digest('hex').slice(0, 8),
      16,
    ) % INDEX_SHARDS
  );
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function compareBigint(a: string, b: string): number {
  return BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
}

export interface PostingsShard {
  path: string;
  sha256: string;
  tokens: number;
  postings: number;
}

export interface PostingsResult {
  shards: PostingsShard[];
  tokens: number;
  postings: number;
}

/**
 * Two-pass token postings with bounded RAM: pass 1 appends `{t,c}` pairs into
 * per-shard tmp files; pass 2 sorts/dedupes one shard at a time into final JSONL
 * `{t,n,c:[ids]}` lines (tokens asc, ids asc by bigint).
 */
export class TokenPostingBuilder {
  private readonly writers: (JsonlWriter | null)[] = Array.from(
    { length: INDEX_SHARDS },
    (): JsonlWriter | null => null,
  );
  private program: string;

  constructor(
    private readonly root: string,
    private readonly tmpDirRel: string,
    private readonly outDirRel: string,
    name: string,
  ) {
    this.program = name;
  }

  add(token: string, id: string): void {
    const shard = shardIndex(token);
    let writer = this.writers[shard];
    if (!writer) {
      writer = new JsonlWriter(
        this.root,
        `${this.tmpDirRel}/${pad(shard)}.jsonl`,
      );
      this.writers[shard] = writer;
    }
    writer.write({ c: id, t: token });
  }

  finish(): PostingsResult {
    for (const writer of this.writers) writer?.close();
    const shards: PostingsShard[] = [];
    let totalTokens = 0;
    let totalPostings = 0;
    for (let shard = 0; shard < INDEX_SHARDS; shard += 1) {
      const tmpRel = `${this.tmpDirRel}/${pad(shard)}.jsonl`;
      const tmpAbs = resolveArtifact(this.root, tmpRel);
      const grouped = new Map<string, string[]>();
      if (existsSync(tmpAbs)) {
        const content = readFileSync(tmpAbs, 'utf8');
        for (const line of content.split('\n')) {
          if (!line) continue;
          const pair = JSON.parse(line) as { t: string; c: string };
          const list = grouped.get(pair.t);
          if (list) list.push(pair.c);
          else grouped.set(pair.t, [pair.c]);
        }
        rmSync(tmpAbs);
      }
      const tokens = [...grouped.keys()].sort();
      const writer = new JsonlWriter(
        this.root,
        `${this.outDirRel}/${pad(shard)}.jsonl`,
      );
      let postings = 0;
      for (const token of tokens) {
        const ids = [...new Set(grouped.get(token) ?? [])].sort(compareBigint);
        writer.write({ t: token, n: ids.length, c: ids });
        postings += ids.length;
      }
      const written = writer.close();
      totalTokens += tokens.length;
      totalPostings += postings;
      shards.push({
        path: written.ref.path,
        sha256: written.ref.sha256,
        tokens: tokens.length,
        postings,
      });
    }
    return { shards, tokens: totalTokens, postings: totalPostings };
  }
}

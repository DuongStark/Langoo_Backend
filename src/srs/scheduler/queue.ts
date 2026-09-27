import { DueCursorValue } from '../../common/pagination/cursor';

/** 0 = learning/relearning (không giới hạn), 1 = review, 2 = new. */
export type DueBucket = 0 | 1 | 2;

export interface DueCandidate {
  srsId: bigint;
  dueAt: Date;
  bucket: DueBucket;
}

export interface DueCaps {
  newRemaining: number;
  reviewRemaining: number;
}

export interface DueCounts {
  learning: number;
  review: number;
  new: number;
}

export interface DueQueueResult {
  rows: DueCandidate[];
  nextCursor: DueCursorValue | null;
  counts: DueCounts;
}

/**
 * Chọn hàng đợi từ danh sách đã được repository sắp xếp:
 * learning/relearning → review → new; áp daily cap cho review/new
 * (intraday learning không giới hạn — semantics Anki); cắt theo cursor + limit.
 */
export function selectDueQueue(
  candidates: DueCandidate[],
  caps: DueCaps,
  cursor: DueCursorValue | null,
  limit: number,
): DueQueueResult {
  const counts: DueCounts = { learning: 0, review: 0, new: 0 };
  const eligible: DueCandidate[] = [];

  for (const row of candidates) {
    if (row.bucket === 1 && counts.review >= caps.reviewRemaining) {
      continue;
    }
    if (row.bucket === 2 && counts.new >= caps.newRemaining) {
      continue;
    }
    if (row.bucket === 0) {
      counts.learning += 1;
    } else if (row.bucket === 1) {
      counts.review += 1;
    } else {
      counts.new += 1;
    }
    eligible.push(row);
  }

  const filtered =
    cursor === null
      ? eligible
      : eligible.filter((row) => isAfterCursor(row, cursor));
  const rows = filtered.slice(0, limit);
  const last = rows[rows.length - 1];
  const hasMore = filtered.length > rows.length;

  return {
    rows,
    nextCursor:
      hasMore && last !== undefined
        ? {
            bucket: last.bucket,
            dueAt: last.dueAt.toISOString(),
            srsId: last.srsId.toString(),
          }
        : null,
    counts,
  };
}

function isAfterCursor(row: DueCandidate, cursor: DueCursorValue): boolean {
  if (row.bucket !== cursor.bucket) {
    return row.bucket > cursor.bucket;
  }
  const cursorDueAt = new Date(cursor.dueAt).getTime();
  if (row.dueAt.getTime() !== cursorDueAt) {
    return row.dueAt.getTime() > cursorDueAt;
  }
  return row.srsId > BigInt(cursor.srsId);
}

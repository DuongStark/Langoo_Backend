import { DueCursorValue } from '../../common/pagination/cursor';

/** 0 = learning/relearning (không giới hạn), 1 = review, 2 = new. */
export type DueBucket = 0 | 1 | 2;

export interface DueCandidate {
  srsId: bigint;
  /** collection_item nhóm các face song ngữ và hai chiều SRS của một từ. */
  itemId?: string;
  dueAt: Date;
  bucket: DueBucket;
  dueAtKey?: string;
  learningIsInterday?: boolean;
  sortKey?: string;
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
 * New dùng `sortKey` gồm collection, position, item, due_at và id để khớp
 * thứ tự SQL. Learning được giữ độc lập; trong mỗi item chọn tối đa một
 * sibling new/review, vì review một learning sẽ bury những sibling này.
 */
export function selectDueQueue(
  candidates: DueCandidate[],
  caps: DueCaps,
  cursor: DueCursorValue | null,
  limit: number,
): DueQueueResult {
  const counts: DueCounts = { learning: 0, review: 0, new: 0 };
  const eligible: DueCandidate[] = [];
  let reviewQuotaUsed = 0;
  const learningItems = new Set<string>();
  const selectedSiblingItems = new Set<string>();

  for (const row of candidates) {
    const itemId = row.itemId;
    if (itemId !== undefined && row.bucket !== 0 && learningItems.has(itemId)) {
      // Một learning card sẽ bury sibling new/review khi được trả lời.
      continue;
    }
    if (
      itemId !== undefined &&
      row.bucket !== 0 &&
      selectedSiblingItems.has(itemId)
    ) {
      continue;
    }

    const consumesReviewQuota =
      row.bucket === 1 ||
      (row.bucket === 0 && (row.learningIsInterday ?? false));
    if (consumesReviewQuota && reviewQuotaUsed >= caps.reviewRemaining) {
      continue;
    }
    if (consumesReviewQuota) {
      reviewQuotaUsed += 1;
    }
    if (row.bucket === 2 && counts.new >= caps.newRemaining) {
      continue;
    }
    if (row.bucket === 0) {
      counts.learning += 1;
      if (itemId !== undefined) learningItems.add(itemId);
    } else if (row.bucket === 1) {
      counts.review += 1;
      if (itemId !== undefined) selectedSiblingItems.add(itemId);
    } else {
      counts.new += 1;
      if (itemId !== undefined) selectedSiblingItems.add(itemId);
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
            dueAt: last.dueAtKey ?? dateKey(last.dueAt),
            srsId: last.srsId.toString(),
            ...(last.dueAtKey === undefined &&
            last.learningIsInterday === undefined
              ? {}
              : { interday: last.learningIsInterday ?? false }),
            ...(last.sortKey === undefined ? {} : { sortKey: last.sortKey }),
          }
        : null,
    counts,
  };
}

/** Practice không áp quota nhưng phải tránh snapshot chứa sibling sẽ bị bury. */
export function selectPracticeRepresentatives<
  T extends { item_id: string; state: string },
>(rows: T[]): T[] {
  const learningItems = new Set(
    rows
      .filter((row) => row.state === 'learning' || row.state === 'relearning')
      .map((row) => row.item_id),
  );
  const selectedSiblingItems = new Set<string>();

  return rows.filter((row) => {
    if (row.state === 'learning' || row.state === 'relearning') return true;
    if (learningItems.has(row.item_id)) return false;
    if (selectedSiblingItems.has(row.item_id)) return false;
    selectedSiblingItems.add(row.item_id);
    return true;
  });
}

function isAfterCursor(row: DueCandidate, cursor: DueCursorValue): boolean {
  if (row.bucket !== cursor.bucket) {
    return row.bucket > cursor.bucket;
  }
  if (row.bucket === 2 && cursor.sortKey !== undefined) {
    return (row.sortKey ?? '') > cursor.sortKey;
  }
  if (
    row.bucket === 0 &&
    (row.learningIsInterday ?? false) !== (cursor.interday ?? false)
  ) {
    return (row.learningIsInterday ?? false) && !(cursor.interday ?? false);
  }
  const rowDueAt = normalizeDateKey(row.dueAtKey ?? dateKey(row.dueAt));
  const cursorDueAt = normalizeDateKey(cursor.dueAt);
  if (rowDueAt !== cursorDueAt) {
    return rowDueAt > cursorDueAt;
  }
  return row.srsId > BigInt(cursor.srsId);
}

function dateKey(date: Date): string {
  return date.toISOString();
}

function normalizeDateKey(value: string): string {
  const match = value.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{1,6})Z$/,
  );
  if (match) {
    return `${match[1]}.${match[2].padEnd(6, '0')}Z`;
  }
  const date = new Date(value);
  return dateKey(date);
}

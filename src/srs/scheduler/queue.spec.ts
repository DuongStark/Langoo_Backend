import { DueCandidate, selectDueQueue } from './queue';

const T0 = new Date('2026-09-27T09:00:00.000Z');
const T1 = new Date('2026-09-27T09:05:00.000Z');
const T2 = new Date('2026-09-27T09:10:00.000Z');
const T3 = new Date('2026-09-27T09:15:00.000Z');

/** Thứ tự đã được repository sắp: learning(0) → review(1) → new(2), dueAt asc. */
const candidates: DueCandidate[] = [
  { srsId: 11n, dueAt: T0, bucket: 0 },
  { srsId: 12n, dueAt: T1, bucket: 0 },
  { srsId: 21n, dueAt: T2, bucket: 1 },
  { srsId: 22n, dueAt: T3, bucket: 1 },
  { srsId: 23n, dueAt: T3, bucket: 1 },
  { srsId: 31n, dueAt: T0, bucket: 2 },
  { srsId: 32n, dueAt: T1, bucket: 2 },
];

describe('selectDueQueue', () => {
  it('áp daily cap theo bucket; learning không bị giới hạn', () => {
    const result = selectDueQueue(
      candidates,
      { newRemaining: 1, reviewRemaining: 2 },
      null,
      50,
    );

    expect(result.rows.map((row) => row.srsId)).toEqual([
      11n,
      12n,
      21n,
      22n,
      31n,
    ]);
    expect(result.counts).toEqual({ learning: 2, review: 2, new: 1 });
  });

  it('cap = 0 → bỏ hẳn bucket đó, learning vẫn còn', () => {
    const result = selectDueQueue(
      candidates,
      { newRemaining: 0, reviewRemaining: 0 },
      null,
      50,
    );
    expect(result.rows.map((row) => row.srsId)).toEqual([11n, 12n]);
    expect(result.counts).toEqual({ learning: 2, review: 0, new: 0 });
  });

  it('cursor keyset (bucket, dueAt, srsId) — không lặp dòng', () => {
    const result = selectDueQueue(
      candidates,
      { newRemaining: 10, reviewRemaining: 10 },
      { bucket: 1, dueAt: T3.toISOString(), srsId: '22' },
      50,
    );
    expect(result.rows.map((row) => row.srsId)).toEqual([23n, 31n, 32n]);
  });

  it('limit + next_cursor: còn dòng thì trả cursor của dòng cuối', () => {
    const first = selectDueQueue(
      candidates,
      { newRemaining: 10, reviewRemaining: 10 },
      null,
      3,
    );
    expect(first.rows.map((row) => row.srsId)).toEqual([11n, 12n, 21n]);
    expect(first.nextCursor).toEqual({
      bucket: 1,
      dueAt: T2.toISOString(),
      srsId: '21',
    });

    const second = selectDueQueue(
      candidates,
      { newRemaining: 10, reviewRemaining: 10 },
      first.nextCursor,
      3,
    );
    expect(second.rows.map((row) => row.srsId)).toEqual([22n, 23n, 31n]);
    expect(second.nextCursor).toEqual({
      bucket: 2,
      dueAt: T0.toISOString(),
      srsId: '31',
    });

    const last = selectDueQueue(
      candidates,
      { newRemaining: 10, reviewRemaining: 10 },
      second.nextCursor,
      3,
    );
    expect(last.rows.map((row) => row.srsId)).toEqual([32n]);
    expect(last.nextCursor).toBeNull();
  });

  it('danh sách rỗng → counts 0, cursor null', () => {
    const result = selectDueQueue(
      [],
      { newRemaining: 5, reviewRemaining: 5 },
      null,
      20,
    );
    expect(result).toEqual({
      rows: [],
      nextCursor: null,
      counts: { learning: 0, review: 0, new: 0 },
    });
  });
});

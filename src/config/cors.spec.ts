import { parseCorsOrigins } from './cors';

describe('parseCorsOrigins', () => {
  it('tắt CORS khi biến trống hoặc undefined', () => {
    expect(parseCorsOrigins(undefined)).toBeNull();
    expect(parseCorsOrigins('')).toBeNull();
    expect(parseCorsOrigins('   ')).toBeNull();
    expect(parseCorsOrigins(', ,')).toBeNull();
  });

  it('hiểu "*" thành cho phép mọi origin (phản chiếu origin của request)', () => {
    expect(parseCorsOrigins('*')).toBe(true);
    expect(parseCorsOrigins(' * ')).toBe(true);
    expect(parseCorsOrigins('https://a.dev,*')).toBe(true);
  });

  it('trả danh sách origin đã trim khi không có "*"', () => {
    expect(parseCorsOrigins('https://a.dev, http://localhost:5173')).toEqual([
      'https://a.dev',
      'http://localhost:5173',
    ]);
    expect(parseCorsOrigins('https://a.dev,,')).toEqual(['https://a.dev']);
  });
});

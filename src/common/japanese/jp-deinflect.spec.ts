import { deinflectJapanese, deinflectJapaneseDetailed } from './jp-deinflect';

describe('jp-deinflect (M4.9)', () => {
  describe('§7.1 — Dữ liệu thật từ file Mazii & các thể chia chuẩn', () => {
    const cases: [string, string][] = [
      // Bảng A: Danh từ / trạng từ + する
      ['応募する', '応募'],
      ['定義する', '定義'],
      ['ほっとする', 'ほっと'],
      ['仲直りする', '仲直り'],
      ['勉強します', '勉強'],
      ['勉強しました', '勉強'],
      ['勉強して', '勉強'],
      ['紹介される', '紹介'],

      // Bảng B ★: Tính từ đuôi な & tính từ đuôi い dạng く
      ['親切な', '親切'],
      ['いい加減な', 'いい加減'],
      ['盛んな', '盛ん'],
      ['派手な', '派手'],
      ['細く', '細い'],
      ['まぶしく', 'まぶしい'],
      ['高かった', '高い'],

      // Bảng C: Thể て / た (âm tiện)
      ['慌てて', '慌てる'],
      ['驚いた', '驚く'],
      ['行った', '行く'],
      ['読んだ', '読む'],

      // Bảng D: Thể phủ định / lịch sự / ている / khả năng / です
      ['たおさない', 'たおす'],
      ['食べなかった', '食べる'],
      ['読みます', '読む'],
      ['食べています', '食べる'],
      ['見られる', '見る'],
      ['学生です', '学生'],

      // §4.3: Cụm câu nói có する ở giữa
      ['勘弁してくれ', '勘弁'],
      ['勘弁してください', '勘弁'],
    ];

    it.each(cases)('"%s" sinh ra dạng gốc "%s"', (input, expected) => {
      const candidates = deinflectJapanese(input);
      expect(candidates).toContain(expected);
      expect(candidates.length).toBeLessThanOrEqual(8);
    });

    it('đặt danh từ bỏ する lên đầu tiên cho input kết thúc bằng する', () => {
      expect(deinflectJapanese('応募する')[0]).toBe('応募');
      expect(deinflectJapanese('ほっとする')[0]).toBe('ほっと');
    });

    it('chuẩn hóa katakana sang hiragana trước khi áp quy tắc', () => {
      expect(deinflectJapanese('オウボスル')).toContain('おうぼ');
    });
  });

  describe('§7.2 — Bảo vệ không sinh sai cho từ Latin/Kanji-only/ngắn', () => {
    it('không sinh ứng viên cho từ tiếng Anh không phải romaji suru', () => {
      expect(deinflectJapanese('running')).toEqual([]);
      expect(deinflectJapanese('bank')).toEqual([]);
    });

    it('không sinh ứng viên cho từ chỉ gồm Kanji (không có kana)', () => {
      expect(deinflectJapanese('何位')).toEqual([]);
      expect(deinflectJapanese('花')).toEqual([]);
    });

    it('không cắt する một mình thành chuỗi rỗng', () => {
      expect(deinflectJapanese('する')).not.toContain('');
    });

    it('gắn expectedPos hợp lý để hỗ trợ xếp hạng mềm', () => {
      const naHit = deinflectJapaneseDetailed('親切な').find(
        (c) => c.word === '親切',
      );
      expect(naHit?.expectedPos).toEqual(
        expect.arrayContaining(['adjective', 'noun']),
      );

      const kuHit = deinflectJapaneseDetailed('細く').find(
        (c) => c.word === '細い',
      );
      expect(kuHit?.expectedPos).toContain('adjective');

      const suruHit = deinflectJapaneseDetailed('応募する').find(
        (c) => c.word === '応募',
      );
      expect(suruHit?.expectedPos).toContain('noun');
    });
  });
});

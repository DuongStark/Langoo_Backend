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

  describe('Regression 2026-11-20 — Động từ đuôi れる / せる / てる không bị bóc nhầm sang từ khác', () => {
    const ichidanPastCases: [string, string][] = [
      ['優れた', '優れる'],
      ['優れて', '優れる'],
      ['見せた', '見せる'],
      ['見せて', '見せる'],
      ['切れた', '切れる'],
      ['取れた', '取れる'],
      ['売れた', '売れる'],
      ['生まれた', '生まれる'],
      ['捨てた', '捨てる'],
      ['当てた', '当てる'],
      ['慌てて', '慌てる'],
      ['忘れた', '忘れる'],
      ['壊れた', '壊れる'],
      ['食べた', '食べる'],
    ];

    it.each(ichidanPastCases)(
      '"%s" luôn đặt dạng gốc đúng "%s" ở vị trí #1 (tier đầu tiên)',
      (input, expected) => {
        const detailed = deinflectJapaneseDetailed(input);
        expect(detailed[0]?.word).toBe(expected);
        // Nếu có ứng viên bóc sâu hơn (vd 優る / 切る / 生む), phải nằm ở tier sau
        if (detailed.length > 1) {
          expect(detailed[1].tier).toBeGreaterThan(detailed[0].tier);
        }
      },
    );

    it('không biến 見せる / 乗せる (Kanji + せる) thành 見る / 乗る', () => {
      expect(deinflectJapanese('見せる')).toEqual([]);
      expect(deinflectJapanese('乗せる')).toEqual([]);
      expect(deinflectJapanese('見せた')).toEqual(['見せる']);
    });

    it('vẫn hỗ trợ bị động / sai khiến / khả năng godan nhiều lớp', () => {
      expect(deinflectJapanese('読まれる')).toContain('読む');
      expect(deinflectJapanese('読まれた')).toContain('読む');
      expect(deinflectJapanese('読まれなかった')).toContain('読む');
      expect(deinflectJapanese('読ませる')).toContain('読む');
      expect(deinflectJapanese('書かせる')).toContain('書く');
      expect(deinflectJapanese('走れた')).toContain('走る');
      expect(deinflectJapanese('作れた')).toContain('作る');
      expect(deinflectJapanese('見てた')).toContain('見る');
      expect(deinflectJapanese('食べてた')).toContain('食べる');
      expect(deinflectJapanese('食べさせられなかった')).toContain('食べる');
    });

    it('gom các ứng viên cùng tầng âm tiện (行った -> 行う/行く) vào cùng 1 tier', () => {
      const detailed = deinflectJapaneseDetailed('行った');
      const okonau = detailed.find((c) => c.word === '行う');
      const iku = detailed.find((c) => c.word === '行く');
      expect(okonau).toBeDefined();
      expect(iku).toBeDefined();
      expect(iku?.tier).toBe(okonau?.tier);
    });
  });
});

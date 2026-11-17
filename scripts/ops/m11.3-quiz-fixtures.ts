import type { QuizSourceItem } from '../../src/ai/providers/ai-quiz.provider';
import type { QuizSkill } from '../../src/ai/quiz/v3/quiz-blueprint';

export interface PilotFixture {
  name: string;
  languageId: number;
  skills: QuizSkill[];
  items: QuizSourceItem[];
}
const enNouns = [
  ['train', 'tàu hỏa', 'a railway vehicle for carrying passengers'],
  ['station', 'nhà ga', 'a place where trains stop for passengers'],
  ['ticket', 'vé', 'a document that permits travel or entry'],
  ['platform', 'sân ga', 'the raised area beside a railway track'],
  [
    'passenger',
    'hành khách',
    'a person travelling in a vehicle without driving it',
  ],
  ['luggage', 'hành lý', 'bags and suitcases carried when travelling'],
  ['entrance', 'lối vào', 'a way into a place'],
  ['exit', 'lối ra', 'a way out of a place'],
  ['journey', 'chuyến đi', 'an act of travelling from one place to another'],
  ['delay', 'sự chậm trễ', 'a period of waiting longer than expected'],
  ['seat', 'chỗ ngồi', 'a place for one person to sit'],
  ['schedule', 'lịch trình', 'a plan listing the times of events'],
];
const enVerbs = [
  ['accept', 'chấp nhận', 'to agree to receive or do something'],
  ['refuse', 'từ chối', 'to say that one will not accept or do something'],
  ['borrow', 'mượn', 'to receive something temporarily and return it later'],
  [
    'lend',
    'cho mượn',
    'to give something temporarily and receive it back later',
  ],
  ['buy', 'mua', 'to obtain something by paying money'],
  ['sell', 'bán', 'to give something in exchange for money'],
  ['bring', 'mang đến', 'to carry something towards a person or place'],
  ['take', 'mang đi', 'to carry something away to another place'],
  ['arrive', 'đến nơi', 'to reach a destination'],
  ['leave', 'rời đi', 'to go away from a place'],
  ['remember', 'nhớ', 'to keep or bring information in mind'],
  ['forget', 'quên', 'to fail to remember something'],
];
const ja = [
  ['学校', 'がっこう', 'trường học', 'school'],
  ['学生', 'がくせい', 'học sinh, sinh viên', 'student'],
  ['先生', 'せんせい', 'giáo viên', 'teacher'],
  ['大学', 'だいがく', 'trường đại học', 'university'],
  ['図書館', 'としょかん', 'thư viện', 'library'],
  ['病院', 'びょういん', 'bệnh viện', 'hospital'],
  ['電車', 'でんしゃ', 'tàu điện', 'electric train'],
  ['切符', 'きっぷ', 'vé', 'ticket'],
  ['乗客', 'じょうきゃく', 'hành khách', 'passenger'],
  ['荷物', 'にもつ', 'hành lý', 'luggage'],
  ['入口', 'いりぐち', 'lối vào', 'entrance'],
  ['出口', 'でぐち', 'lối ra', 'exit'],
  ['旅行', 'りょこう', 'du lịch', 'travel'],
  ['時刻表', 'じこくひょう', 'bảng giờ tàu xe', 'timetable'],
  ['改札口', 'かいさつぐち', 'cổng soát vé', 'ticket gate'],
  ['空港', 'くうこう', 'sân bay', 'airport'],
  ['飛行機', 'ひこうき', 'máy bay', 'airplane'],
  ['自転車', 'じてんしゃ', 'xe đạp', 'bicycle'],
  ['食堂', 'しょくどう', 'nhà ăn', 'dining hall'],
  ['宿題', 'しゅくだい', 'bài tập về nhà', 'homework'],
  ['教室', 'きょうしつ', 'phòng học', 'classroom'],
  ['約束', 'やくそく', 'lời hứa', 'promise'],
  ['予約', 'よやく', 'đặt chỗ trước', 'reservation'],
  ['出発', 'しゅっぱつ', 'sự khởi hành', 'departure'],
];

// Authored public vocabulary, synthetic IDs; no learner data or DB writes.
export const pilotFixtures: PilotFixture[] = [
  {
    name: 'en-daily-travel-20',
    languageId: 1,
    skills: ['meaning', 'context_cloze', 'context_meaning', 'usage'],
    items: enNouns
      .flatMap(
        (noun, i) =>
          [
            [noun, 'noun'],
            [enVerbs[i], 'verb'],
          ] as const,
      )
      .map(([word, pos], i) => ({
        itemId: `public-en-${i}`,
        senseId: `public-en-sense-${i}`,
        conceptId: null,
        languageId: 1,
        languageCode: 'en',
        lemma: word[0],
        reading: null,
        romanization: null,
        meaningVi: word[1],
        glossEn: [word[2]],
        glossViMachine: false,
        pos,
      })),
  },
  {
    name: 'ja-kanji-daily-20',
    languageId: 2,
    skills: [
      'meaning',
      'kanji_reading',
      'kanji_orthography',
      'context_cloze',
      'usage',
    ],
    items: ja.map(([written, reading, vi, en], i) => ({
      itemId: `public-ja-${i}`,
      senseId: `public-ja-sense-${i}`,
      conceptId: null,
      languageId: 2,
      languageCode: 'ja',
      lemma: written,
      reading,
      romanization: null,
      meaningVi: vi,
      glossEn: [en],
      glossViMachine: false,
      pos: 'noun',
      kanjiPairs: [{ written, reading, eligible: true }],
    })),
  },
];

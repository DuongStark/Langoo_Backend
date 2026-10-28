import { PrismaService } from '../db/prisma.service';
import { DueRepository, DueRow } from './repositories/due.repository';
import { SrsStatsRepository } from './repositories/srs-stats.repository';
import { ReviewEngine } from './review-engine.service';
import { SrsService } from './srs.service';

describe('SrsService flashcard word metadata', () => {
  it.each([
    { direction: 'recognize', pos: 'verb', wordSide: 'prompt' },
    { direction: 'recall', pos: 'verb', wordSide: 'answer' },
    { direction: 'recognize', pos: null, wordSide: 'prompt' },
    { direction: 'recall', pos: null, wordSide: 'answer' },
  ] as const)(
    'returns pos=$pos on $wordSide for $direction',
    async ({ direction, pos, wordSide }) => {
      const prisma = {
        userSettings: {
          findUnique: jest.fn().mockResolvedValue({
            activeProfileId: 'profile-1',
            timezone: 'UTC',
          }),
        },
        studyProfile: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'profile-1',
            primaryLanguageId: 2,
            secondaryLanguageId: null,
          }),
        },
      };
      const row: DueRow = {
        srs_id: 7n,
        face_id: 'face-1',
        item_id: 'item-1',
        collection_id: 'collection-1',
        item_position: 1,
        meaning_vi: 'chạy',
        meaning_source: 'source',
        sense_id: 1n,
        language_id: 2,
        role: 'primary',
        lang_code: 'ja',
        lang_name_vi: 'Tiếng Nhật',
        lemma: '走る',
        reading: 'はしる',
        romanization: 'hashiru',
        pos,
        forms: [],
        direction,
        state: 'review',
        learning_is_interday: false,
        due_at: new Date('2020-01-01T00:00:00.000Z'),
        due_at_key: '2020-01-01T00:00:00.000000Z',
      };
      const dueRepo = {
        getDayCounts: jest.fn().mockResolvedValue({
          introducedToday: 0,
          reviewsToday: 0,
        }),
        findCandidates: jest.fn().mockResolvedValue([row]),
      };
      const service = new SrsService(
        prisma as unknown as PrismaService,
        dueRepo as unknown as DueRepository,
        {} as SrsStatsRepository,
        {} as ReviewEngine,
      );

      const result = await service.getDue(1n, {});
      const payload = JSON.parse(JSON.stringify(result)) as {
        data: {
          prompt: Record<string, unknown>;
          answer: Record<string, unknown>;
        }[];
      };

      expect(payload.data).toHaveLength(1);
      expect(payload.data[0][wordSide]).toEqual({
        kind: 'word',
        text: '走る',
        reading: 'はしる',
        romanization: 'hashiru',
        pos,
      });
      const meaningSide = wordSide === 'prompt' ? 'answer' : 'prompt';
      expect(payload.data[0][meaningSide]).toMatchObject({
        kind: 'meaning',
        text: 'chạy',
      });
      expect(payload.data[0][meaningSide]).not.toHaveProperty('pos');
    },
  );
});

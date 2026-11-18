import { validate } from 'class-validator';
import { CreateReviewDto } from './create-review.dto';
import { SuspendCardDto } from './suspend-card.dto';

describe('recognize-only request compatibility', () => {
  const face_id = '11111111-1111-4111-8111-111111111111';
  it.each([CreateReviewDto, SuspendCardDto])(
    '%p allows omitted or recognize direction and rejects recall',
    async (Dto) => {
      const values = { face_id, rating: 3, suspended: true };
      expect(await validate(Object.assign(new Dto(), values))).toEqual([]);
      expect(
        await validate(
          Object.assign(new Dto(), values, { direction: 'recognize' }),
        ),
      ).toEqual([]);
      expect(
        await validate(
          Object.assign(new Dto(), values, { direction: 'recall' }),
        ),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ property: 'direction' }),
        ]),
      );
      expect(
        await validate(Object.assign(new Dto(), values, { direction: null })),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ property: 'direction' }),
        ]),
      );
    },
  );
});

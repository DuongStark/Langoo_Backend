import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListItemsQueryDto } from './list-items-query.dto';
describe('M5.2 ListItemsQueryDto order', () => {
  it.each([undefined, 'asc', 'desc'])('accepts direction %s', async (order) => {
    const dto = plainToInstance(
      ListItemsQueryDto,
      order === undefined ? {} : { order },
    );
    expect(await validate(dto)).toHaveLength(0);
  });
  it.each(['DESC', '', 'newest', null, ['asc', 'desc']])(
    'rejects invalid direction %p',
    async (order) => {
      const dto = plainToInstance(ListItemsQueryDto, { order });
      expect((await validate(dto)).some((x) => x.property === 'order')).toBe(
        true,
      );
    },
  );
});

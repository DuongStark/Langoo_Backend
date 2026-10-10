import 'reflect-metadata';
import { SearchHitDto, SenseCardDto } from './dictionary-response.dto';

describe('M4.5 dictionary response metadata', () => {
  it('loads the preview DTO class before evaluating decorator metadata', () => {
    expect(
      Reflect.getMetadata('design:type', SearchHitDto.prototype, 'preview'),
    ).toBe(SenseCardDto);
  });
});

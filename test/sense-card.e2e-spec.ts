import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { SenseCardRepository } from '../src/dictionary/repositories/sense-card.repository';

describe('SenseCardRepository (e2e — langoo_test)', () => {
  let app: INestApplication;
  let repository: SenseCardRepository;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    repository = app.get(SenseCardRepository);
  });

  afterAll(async () => {
    await app.close();
  });

  it('đọc sense 走る (sense_id=1) từ serve.sense_card', async () => {
    const card = await repository.getBySenseId(1n);

    expect(card).toMatchObject({
      senseId: 1n,
      lexemeId: 1n,
      languageId: 2,
      lemma: '走る',
      glossVi: 'chạy',
      glossEn: 'to run',
      glossViMachine: false,
      glossViReviewed: false,
      isPrimary: true,
    });
    expect(typeof card?.conceptId).toBe('bigint');
  });

  it('đọc sense run (sense_id=2) — lexeme tiếng Anh', async () => {
    const card = await repository.getBySenseId(2n);

    expect(card).toMatchObject({
      languageId: 1,
      lemma: 'run',
      glossVi: 'chạy',
    });
  });

  it('sense không tồn tại trả null', async () => {
    await expect(repository.getBySenseId(999999n)).resolves.toBeNull();
  });
});

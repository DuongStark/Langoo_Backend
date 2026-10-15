import { PrismaService } from '../db/prisma.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminCurationService } from './admin-curation.service';

function createSetup() {
  const queryRaw = jest.fn();
  const executeRaw = jest.fn();
  const executeRawUnsafe = jest.fn().mockResolvedValue(undefined);
  const prisma = {
    $queryRaw: queryRaw,
    $executeRaw: executeRaw,
    $executeRawUnsafe: executeRawUnsafe,
    $transaction: jest.fn((fn: (client: unknown) => Promise<unknown>) =>
      fn({ $queryRaw: queryRaw, $executeRaw: executeRaw }),
    ),
  };
  const audit = { record: jest.fn() };
  const service = new AdminCurationService(
    prisma as unknown as PrismaService,
    audit as unknown as AdminAuditService,
  );
  return { service, prisma, queryRaw, executeRaw, executeRawUnsafe, audit };
}

function glossRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1n,
    senseId: 10n,
    text: 'nghĩa cũ',
    isMachine: true,
    quality: null,
    rank: 1,
    reviewedBy: null,
    reviewedByEmail: null,
    reviewedAt: null,
    ...overrides,
  };
}

describe('AdminCurationService', () => {
  it('updateGloss không có thay đổi → 400 NO_CHANGES', async () => {
    const { service } = createSetup();
    await expect(service.updateGloss(5n, 1n, {})).rejects.toMatchObject({
      code: 'NO_CHANGES',
    });
  });

  it('updateGloss gloss không tồn tại → 404 GLOSS_NOT_FOUND', async () => {
    const { service, queryRaw } = createSetup();
    queryRaw.mockResolvedValueOnce([]);
    await expect(
      service.updateGloss(5n, 1n, { text: 'mới' }),
    ).rejects.toMatchObject({ code: 'GLOSS_NOT_FOUND' });
  });

  it('updateGloss sửa text gloss máy → tự bỏ cờ is_machine + audit', async () => {
    const { service, queryRaw, audit } = createSetup();
    queryRaw
      .mockResolvedValueOnce([glossRow()])
      .mockResolvedValueOnce([
        glossRow({ text: 'nghĩa mới', isMachine: false }),
      ]);
    const result = await service.updateGloss(5n, 1n, { text: 'nghĩa mới' });
    expect(result).toMatchObject({ text: 'nghĩa mới', is_machine: false });
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'curation.gloss.update',
        targetKind: 'sense_gloss',
        targetId: '1',
      }),
    );
  });

  it('updateGloss đánh dấu đã duyệt → reviewed_by = admin', async () => {
    const { service, queryRaw } = createSetup();
    queryRaw.mockResolvedValueOnce([glossRow()]).mockResolvedValueOnce([
      glossRow({
        reviewedBy: 5n,
        reviewedByEmail: null,
        reviewedAt: new Date('2026-10-15T00:00:00Z'),
      }),
    ]);
    const result = await service.updateGloss(5n, 1n, { reviewed: true });
    expect(result).toMatchObject({ reviewed_by: '5' });
  });

  it('createGloss sense không tồn tại → 404 SENSE_NOT_FOUND', async () => {
    const { service, queryRaw } = createSetup();
    queryRaw.mockResolvedValueOnce([]);
    await expect(
      service.createGloss(5n, 99n, { text: 'nghĩa' }),
    ).rejects.toMatchObject({ code: 'SENSE_NOT_FOUND' });
  });

  it('addMapping trùng cặp → 409 MAPPING_EXISTS', async () => {
    const { service, queryRaw } = createSetup();
    queryRaw
      .mockResolvedValueOnce([{ id: 10n }]) // sense
      .mockResolvedValueOnce([{ id: 20n }]) // concept
      .mockResolvedValueOnce([{ id: 200 }]) // source
      .mockResolvedValueOnce([]); // insert conflict
    await expect(
      service.addMapping(5n, 10n, { concept_id: '20' }),
    ).rejects.toMatchObject({ code: 'MAPPING_EXISTS' });
  });

  it('addMapping thành công → audit + refresh serve chạy nền', async () => {
    const { service, queryRaw, audit, executeRawUnsafe } = createSetup();
    queryRaw
      .mockResolvedValueOnce([{ id: 10n }])
      .mockResolvedValueOnce([{ id: 20n }])
      .mockResolvedValueOnce([{ id: 200 }])
      .mockResolvedValueOnce([{ sense_id: 10n, concept_id: 20n }]);
    const result = await service.addMapping(5n, 10n, {
      concept_id: '20',
      relation: 'exact',
    });
    expect(result).toMatchObject({ sense_id: '10', concept_id: '20' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'curation.mapping.create' }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining(
        'REFRESH MATERIALIZED VIEW CONCURRENTLY serve.sense_pair',
      ),
    );
  });

  it('deleteMapping không tồn tại → 404 MAPPING_NOT_FOUND', async () => {
    const { service, queryRaw } = createSetup();
    queryRaw.mockResolvedValueOnce([]);
    await expect(service.deleteMapping(5n, 10n, 20n)).rejects.toMatchObject({
      code: 'MAPPING_NOT_FOUND',
    });
  });

  it('updateConceptStatus trùng trạng thái → 400 NO_CHANGES', async () => {
    const { service, queryRaw } = createSetup();
    queryRaw.mockResolvedValueOnce([{ id: 20n, status: 'curated' }]);
    await expect(
      service.updateConceptStatus(5n, 20n, { status: 'curated' }),
    ).rejects.toMatchObject({ code: 'NO_CHANGES' });
  });

  it('searchSenses trả danh sách gọn cho admin', async () => {
    const { service, queryRaw } = createSetup();
    queryRaw.mockResolvedValueOnce([
      {
        id: 10n,
        externalId: 'jmdict:1000220:1',
        senseNo: 1,
        lemma: '明白',
        reading: 'めいはく',
        romanization: 'meihaku',
        pos: ['adj-na'],
        links: 1,
        glossVi: 'rõ ràng',
      },
    ]);
    const result = await service.searchSenses({ q: '明白' });
    expect(result.data).toEqual([
      expect.objectContaining({
        sense_id: '10',
        external_id: 'jmdict:1000220:1',
        lemma: '明白',
        gloss_vi: 'rõ ràng',
      }),
    ]);
  });

  it('searchConcepts trả concept để chọn thay thế', async () => {
    const { service, queryRaw } = createSetup();
    queryRaw.mockResolvedValueOnce([
      {
        id: 46435n,
        glossEn: 'recovery from danger',
        glossVi: null,
        pos: 'noun',
        status: 'curated',
        links: 12,
      },
    ]);
    const result = await service.searchConcepts({ q: 'recovery' });
    expect(result.data).toEqual([
      expect.objectContaining({
        concept_id: '46435',
        gloss_en: 'recovery from danger',
        status: 'curated',
      }),
    ]);
  });

  it('getGloss không tồn tại → 404 GLOSS_NOT_FOUND', async () => {
    const { service, queryRaw } = createSetup();
    queryRaw.mockResolvedValueOnce([]);
    await expect(service.getGloss(1n)).rejects.toMatchObject({
      code: 'GLOSS_NOT_FOUND',
    });
  });

  it('getGloss trả sense chứa gloss (nối hàng chờ report)', async () => {
    const { service, queryRaw } = createSetup();
    queryRaw.mockResolvedValueOnce([
      {
        ...glossRow({ reviewedByEmail: null }),
        lang: 'vi',
        senseExternalId: 'jmdict:1000220:1',
        senseNo: 1,
        lemma: '明白',
        reading: 'めいはく',
      },
    ]);
    const result = await service.getGloss(1n);
    expect(result).toMatchObject({
      id: '1',
      language: 'vi',
      sense: { sense_id: '10', external_id: 'jmdict:1000220:1' },
    });
  });
});

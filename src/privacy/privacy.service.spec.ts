import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../db/prisma.service';
import { PrivacyService } from './privacy.service';

function setup(required = false) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 1n }]),
    privacyEvent: { findUnique: jest.fn(), create: jest.fn() },
  };
  const db = {
    privacyEvent: { findFirst: jest.fn().mockResolvedValue(null) },
    privacyRequest: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn((run: (value: typeof tx) => unknown) =>
      Promise.resolve(run(tx)),
    ),
  };
  const config = { get: jest.fn().mockReturnValue(required) };
  return {
    service: new PrivacyService(
      db as unknown as PrismaService,
      config as unknown as ConfigService,
    ),
    db,
    tx,
  };
}

describe('M12.1 privacy', () => {
  it('does not impose a minimum account age or claim representative verification', () => {
    const { service } = setup();
    expect(service.manifest().age_policy).toEqual({
      minimum_age: null,
      representative_verification: 'not_implemented',
    });
  });
  it('blocks missing AI consent when enforcement is enabled', async () => {
    const { service } = setup(true);
    await expect(service.assertAiAllowed(1n)).rejects.toMatchObject({
      code: 'PRIVACY_CONSENT_REQUIRED',
    });
  });
  it('honors withdrawal even before enforcement rollout', async () => {
    const { service, db } = setup();
    db.privacyEvent.findFirst.mockResolvedValue({
      action: 'withdraw',
      noticeVersion: '2026-11-03-v1',
    });
    await expect(service.assertAiAllowed(1n)).rejects.toMatchObject({
      code: 'PRIVACY_CONSENT_REQUIRED',
    });
  });
  it('allows only the current grant with enforcement enabled', async () => {
    const { service, db } = setup(true);
    db.privacyEvent.findFirst.mockResolvedValue({
      action: 'grant',
      noticeVersion: service.manifest().notice_version,
    });
    await expect(service.assertAiAllowed(1n)).resolves.toBeUndefined();
    db.privacyEvent.findFirst.mockResolvedValue({
      action: 'grant',
      noticeVersion: 'old',
    });
    await expect(service.assertAiAllowed(1n)).rejects.toMatchObject({
      code: 'PRIVACY_CONSENT_REQUIRED',
    });
  });
  it('rejects stale versions before storing events', async () => {
    const { service, tx } = setup();
    await expect(
      service.recordEvent(1n, {
        purpose_id: 'ai_assistance',
        action: 'grant',
        notice_version: 'old',
        request_id: '019a487d-c65c-7000-8000-000000000001',
      }),
    ).rejects.toMatchObject({ code: 'PRIVACY_NOTICE_OUTDATED' });
    expect(tx.privacyEvent.create).not.toHaveBeenCalled();
  });
  it('rejects reuse of an event request ID with another action', async () => {
    const { service, tx } = setup();
    tx.privacyEvent.findUnique.mockResolvedValue({
      purposeId: 'ai_assistance',
      action: 'grant',
      noticeVersion: service.manifest().notice_version,
    });
    await expect(
      service.recordEvent(1n, {
        purpose_id: 'ai_assistance',
        action: 'withdraw',
        notice_version: service.manifest().notice_version,
        request_id: '019a487d-c65c-7000-8000-000000000001',
      }),
    ).rejects.toMatchObject({ code: 'PRIVACY_REQUEST_CONFLICT' });
  });
  it('fails closed on privacy database errors', async () => {
    const { service, db } = setup(true);
    db.privacyEvent.findFirst.mockRejectedValue(
      new Error('private database detail'),
    );
    await expect(service.assertAiAllowed(1n)).rejects.toMatchObject({
      code: 'PRIVACY_UNAVAILABLE',
      status: 503,
    });
  });
  it('does not expose another user rights request', async () => {
    const { service, db } = setup();
    await expect(
      service.getRequest(1n, '019a487d-c65c-7000-8000-000000000001'),
    ).rejects.toMatchObject({ code: 'PRIVACY_REQUEST_NOT_FOUND' });
    expect(db.privacyRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: '019a487d-c65c-7000-8000-000000000001', userId: 1n },
      }),
    );
  });
  it('replays a committed grant even after the notice version changes', async () => {
    const { service, tx } = setup();
    const createdAt = new Date('2026-11-01T00:00:00Z');
    tx.privacyEvent.findUnique.mockResolvedValue({
      id: 4n,
      requestId: '019a487d-c65c-7000-8000-000000000001',
      purposeId: 'ai_assistance',
      action: 'grant',
      noticeVersion: 'old',
      createdAt,
    });
    const result = await service.recordEvent(1n, {
      purpose_id: 'ai_assistance',
      action: 'grant',
      notice_version: 'old',
      request_id: '019a487d-c65c-7000-8000-000000000001',
    });
    expect(result).toMatchObject({
      id: '4',
      notice_version: 'old',
      created_at: '2026-11-01T00:00:00.000Z',
    });
    expect(tx.privacyEvent.create).not.toHaveBeenCalled();
  });
});

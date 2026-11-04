import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../db/prisma.service';
import { PrivacyService } from './privacy.service';

function setup(required = false) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 1n }]),
    privacyEvent: { findUnique: jest.fn(), create: jest.fn() },
    termsAcceptance: { findUnique: jest.fn(), create: jest.fn() },
  };
  const db = {
    privacyEvent: { findFirst: jest.fn().mockResolvedValue(null) },
    privacyRequest: { findFirst: jest.fn().mockResolvedValue(null) },
    termsAcceptance: { findFirst: jest.fn().mockResolvedValue(null) },
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
  it('publishes versioned terms separately from optional purposes', () => {
    const { service } = setup();
    expect(service.manifest()).toMatchObject({
      terms_version: '2026-11-04-v1',
      terms_url: 'https://langoo.org/terms',
    });
    expect(service.manifest().purposes.map((p) => p.purpose_id)).toEqual([
      'ai_assistance',
      'online_translation',
      'analytics',
    ]);
  });
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
  it('requires action for absent or superseded terms and scopes the read by user', async () => {
    const { service, db } = setup();
    await expect(service.termsState(2n)).resolves.toMatchObject({
      status: 'needs_action',
      latest_acceptance: null,
    });
    const acceptedAt = new Date('2026-11-01T00:00:00Z');
    db.termsAcceptance.findFirst.mockResolvedValue({
      id: 1n,
      userId: 2n,
      requestId: '019a487d-c65c-7000-8000-000000000001',
      termsVersion: 'old',
      acceptedAt,
    });
    await expect(service.termsState(2n)).resolves.toMatchObject({
      status: 'needs_action',
      latest_acceptance: { terms_version: 'old' },
    });
    expect(db.termsAcceptance.findFirst).toHaveBeenLastCalledWith({
      where: { userId: 2n },
      orderBy: { id: 'desc' },
    });
  });
  it('rejects a new stale-version terms event without inserting', async () => {
    const { service, tx } = setup();
    await expect(
      service.acceptTerms(1n, {
        request_id: '019a487d-c65c-7000-8000-000000000001',
        terms_version: 'old',
      }),
    ).rejects.toMatchObject({ code: 'TERMS_VERSION_OUTDATED', status: 409 });
    expect(tx.termsAcceptance.create).not.toHaveBeenCalled();
  });
  it('replays historical terms receipts before checking current version', async () => {
    const { service, tx } = setup();
    const requestId = '019a487d-c65c-7000-8000-000000000001';
    tx.termsAcceptance.findUnique.mockResolvedValue({
      id: 2n,
      userId: 1n,
      requestId,
      termsVersion: 'old',
      acceptedAt: new Date('2026-11-01T00:00:00Z'),
    });
    await expect(
      service.acceptTerms(1n, { request_id: requestId, terms_version: 'old' }),
    ).resolves.toMatchObject({
      id: '2',
      terms_version: 'old',
      accepted_at: '2026-11-01T00:00:00.000Z',
    });
    expect(tx.termsAcceptance.create).not.toHaveBeenCalled();
    expect(tx.privacyEvent.create).not.toHaveBeenCalled();
  });
  it('rejects a reused terms request ID with a different body', async () => {
    const { service, tx } = setup();
    tx.termsAcceptance.findUnique.mockResolvedValue({ termsVersion: 'old' });
    await expect(
      service.acceptTerms(1n, {
        request_id: '019a487d-c65c-7000-8000-000000000001',
        terms_version: '2026-11-04-v1',
      }),
    ).rejects.toMatchObject({ code: 'TERMS_REQUEST_CONFLICT', status: 409 });
    expect(tx.termsAcceptance.create).not.toHaveBeenCalled();
  });
  it('does not infer accepted terms when persistence fails', async () => {
    const { service, db } = setup();
    db.termsAcceptance.findFirst.mockRejectedValue(
      new Error('internal terms DB error'),
    );
    await expect(service.termsState(1n)).rejects.toMatchObject({
      code: 'PRIVACY_UNAVAILABLE',
      status: 503,
    });
    db.$transaction.mockRejectedValue(new Error('internal terms DB error'));
    await expect(
      service.acceptTerms(1n, {
        request_id: '019a487d-c65c-7000-8000-000000000001',
        terms_version: '2026-11-04-v1',
      }),
    ).rejects.toMatchObject({ code: 'PRIVACY_UNAVAILABLE', status: 503 });
  });
});

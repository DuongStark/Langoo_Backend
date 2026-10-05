import { PrismaService } from '../db/prisma.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminUsersService } from './admin-users.service';

function createSetup() {
  const userMock = { update: jest.fn() };
  const queryRaw = jest.fn();
  const prisma = {
    user: userMock,
    $queryRaw: queryRaw,
    $transaction: jest.fn((fn: (client: unknown) => Promise<unknown>) =>
      fn({ user: userMock, $queryRaw: queryRaw }),
    ),
  };
  const audit = { record: jest.fn() };
  const service = new AdminUsersService(
    prisma as unknown as PrismaService,
    audit as unknown as AdminAuditService,
  );
  return { service, prisma, audit };
}

describe('AdminUsersService', () => {
  it('tự khoá chính mình → 409 USER_STATUS_INVALID', async () => {
    const { service } = createSetup();
    await expect(
      service.updateStatus(5n, '5', { status: 'locked' }),
    ).rejects.toMatchObject({ code: 'USER_STATUS_INVALID' });
  });

  it('không đổi trạng thái tài khoản admin khác / tài khoản đã xoá', async () => {
    const { service, prisma } = createSetup();

    prisma.$queryRaw.mockResolvedValue([
      {
        id: 9n,
        status: 'active',
        role: 'admin',
      },
    ]);
    await expect(
      service.updateStatus(5n, '9', { status: 'locked' }),
    ).rejects.toMatchObject({ code: 'USER_STATUS_INVALID' });

    prisma.$queryRaw.mockResolvedValue([
      {
        id: 9n,
        status: 'deleted',
        role: 'user',
      },
    ]);
    await expect(
      service.updateStatus(5n, '9', { status: 'active' }),
    ).rejects.toMatchObject({ code: 'USER_STATUS_INVALID' });
  });

  it('user không tồn tại → 404 USER_NOT_FOUND', async () => {
    const { service, prisma } = createSetup();
    prisma.$queryRaw.mockResolvedValue([]);

    await expect(
      service.updateStatus(5n, '9', { status: 'locked' }),
    ).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  it('trạng thái không đổi → giữ row lock để kiểm tra, không ghi audit', async () => {
    const { service, prisma, audit } = createSetup();
    prisma.$queryRaw.mockResolvedValue([
      {
        id: 9n,
        status: 'locked',
        role: 'user',
      },
    ]);

    const result = await service.updateStatus(5n, '9', { status: 'locked' });

    expect(result).toEqual({ id: '9', status: 'locked' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('khoá user hợp lệ → update + audit', async () => {
    const { service, prisma, audit } = createSetup();
    prisma.$queryRaw.mockResolvedValue([
      {
        id: 9n,
        status: 'active',
        role: 'user',
      },
    ]);
    prisma.user.update.mockResolvedValue({
      id: 9n,
      status: 'locked',
      role: 'user',
    });

    const result = await service.updateStatus(5n, '9', { status: 'locked' });

    expect(result).toEqual({ id: '9', status: 'locked' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        adminUserId: 5n,
        action: 'user.status',
        targetId: '9',
        payload: { status: 'locked' },
      }),
    );
  });
});

import { BadRequestException } from '@nestjs/common';
import {
  DERIVED_OPS_KINDS,
  OPS_KIND_SOURCE,
  OpsQueueService,
} from './ops-queue.service';

/**
 * The one rule this service exists to enforce: an ops row that represents a
 * payout, a KYC review, a report or a dispute is a PROJECTION of a record the
 * marketplace already wrote. A hand-made one would be a task with nothing
 * behind it that somebody could mark resolved without any money moving.
 */
describe('OpsQueueService — what may be created by hand', () => {
  function build() {
    const prisma = {
      opsTask: { create: jest.fn().mockResolvedValue({ id: 'ops-1' }) },
    } as any;
    return { service: new OpsQueueService(prisma), prisma };
  }

  it.each(DERIVED_OPS_KINDS)('refuses to create a %s item', async (kind) => {
    const { service, prisma } = build();
    await expect(
      service.createTask({ subject: 'x', kind } as any, 'staff-1'),
    ).rejects.toThrow(BadRequestException);
    // And nothing was written.
    expect(prisma.opsTask.create).not.toHaveBeenCalled();
  });

  it('names the model a refused kind actually comes from', async () => {
    const { service } = build();
    await expect(
      service.createTask({ subject: 'x', kind: 'WITHDRAWAL' } as any, 's'),
    ).rejects.toThrow(OPS_KIND_SOURCE.WITHDRAWAL);
  });

  it('creates a TASK', async () => {
    const { service, prisma } = build();
    await service.createTask(
      { subject: 'Chase Cedarwood for the permit', kind: 'TASK' } as any,
      'staff-1',
    );
    expect(prisma.opsTask.create).toHaveBeenCalledTimes(1);
    const arg = prisma.opsTask.create.mock.calls[0][0];
    expect(arg.data.subject).toBe('Chase Cedarwood for the permit');
    expect(arg.data.createdById).toBe('staff-1');
  });

  it('defaults to TASK when no kind is given', async () => {
    const { service, prisma } = build();
    await service.createTask({ subject: 'x' } as any, 'staff-1');
    expect(prisma.opsTask.create).toHaveBeenCalledTimes(1);
  });

  it('every derived kind names a real backing model', () => {
    for (const kind of DERIVED_OPS_KINDS) {
      expect(OPS_KIND_SOURCE[kind]).toBeTruthy();
      expect(OPS_KIND_SOURCE[kind]).not.toBe('OpsTask');
    }
    // TASK is the only one that is its own source.
    expect(OPS_KIND_SOURCE.TASK).toBe('OpsTask');
  });
});

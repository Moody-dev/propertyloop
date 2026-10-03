import { BadRequestException } from '@nestjs/common';
import { PartnerDirectoryService } from './partner-directory.service';
import { partnerPayoutGaps, partnerPayoutReady } from './partners.service';
import { AgentPartner } from '../../generated/prisma/client';

function partner(over: Partial<AgentPartner> = {}): AgentPartner {
  return {
    passportPhotoUrl: 'https://r2/photo.jpg',
    bankCode: '058',
    accountNumber: '0123456789',
    nin: '12345678901',
    payerId: 'LIRS-1',
    tin: null,
    ...over,
  } as AgentPartner;
}

describe('partner payout readiness', () => {
  it('is ready when photo, bank, NIN and a tax id are all present', () => {
    expect(partnerPayoutReady(partner())).toBe(true);
    expect(partnerPayoutGaps(partner())).toEqual([]);
  });

  it('accepts a TIN instead of a Payer ID — companies have one, not both', () => {
    const company = partner({ payerId: null, tin: 'TIN-9' });
    expect(partnerPayoutReady(company)).toBe(true);
  });

  it('needs one of the two', () => {
    expect(partnerPayoutGaps(partner({ payerId: null, tin: null }))).toEqual([
      'Payer ID or TIN',
    ]);
  });

  it('treats a bank code without an account number as no bank at all', () => {
    // Half-entered bank details are worse than none: they look complete on a
    // list and fail at the transfer.
    expect(partnerPayoutGaps(partner({ accountNumber: null }))).toContain(
      'bank account',
    );
  });

  it('names every gap for an empty profile', () => {
    const empty = partner({
      passportPhotoUrl: null,
      bankCode: null,
      accountNumber: null,
      nin: null,
      payerId: null,
      tin: null,
    });
    expect(partnerPayoutGaps(empty)).toEqual([
      'passport photo',
      'bank account',
      'NIN',
      'Payer ID or TIN',
    ]);
  });
});

describe('PartnerDirectoryService — recording a commission', () => {
  function build(lead: unknown, existingCommission: unknown = null) {
    const prisma = {
      lead: { findUnique: jest.fn().mockResolvedValue(lead) },
      partnerCommission: {
        findFirst: jest.fn().mockResolvedValue(existingCommission),
        create: jest
          .fn()
          .mockImplementation(({ data }) => ({ id: 'c1', ...data })),
      },
    } as any;
    return { service: new PartnerDirectoryService(prisma), prisma };
  }

  const goodLead = {
    id: 'lead-1',
    listingId: 'listing-1',
    status: 'CONVERTED',
    broughtByPartnerId: 'partner-1',
    listing: { ownership: 'HOUSE' },
  };

  it('refuses a lead no partner introduced', async () => {
    const { service } = build({ ...goodLead, broughtByPartnerId: null });
    await expect(
      service.recordCommission({
        leadId: 'lead-1',
        saleValueNaira: 1_000_000,
        ratePercent: 3,
      }),
    ).rejects.toThrow('not introduced by a partner');
  });

  it("refuses an agent's own listing — partner commission is for house stock", async () => {
    const { service } = build({
      ...goodLead,
      listing: { ownership: 'AGENT_OWN' },
    });
    await expect(
      service.recordCommission({
        leadId: 'lead-1',
        saleValueNaira: 1_000_000,
        ratePercent: 3,
      }),
    ).rejects.toThrow('house inventory only');
  });

  it('refuses a lead that has not closed', async () => {
    const { service } = build({ ...goodLead, status: 'NEGOTIATING' });
    await expect(
      service.recordCommission({
        leadId: 'lead-1',
        saleValueNaira: 1_000_000,
        ratePercent: 3,
      }),
    ).rejects.toThrow('converted');
  });

  it('refuses a second commission on the same introduction', async () => {
    const { service } = build(goodLead, { id: 'already' });
    await expect(
      service.recordCommission({
        leadId: 'lead-1',
        saleValueNaira: 1_000_000,
        ratePercent: 3,
      }),
    ).rejects.toThrow('already been recorded');
  });

  it.each([0, -1])('refuses a sale value of %s', async (v) => {
    const { service } = build(goodLead);
    await expect(
      service.recordCommission({
        leadId: 'lead-1',
        saleValueNaira: v,
        ratePercent: 3,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it.each([0, -5, 101])('refuses a rate of %s%%', async (rate) => {
    const { service } = build(goodLead);
    await expect(
      service.recordCommission({
        leadId: 'lead-1',
        saleValueNaira: 1_000_000,
        ratePercent: rate,
      }),
    ).rejects.toThrow('between 0 and 100');
  });

  it('refuses a commission with no rate — there is no default', async () => {
    const { service } = build(goodLead);
    await expect(
      service.recordCommission({
        leadId: 'lead-1',
        saleValueNaira: 1_000_000,
      } as any),
    ).rejects.toThrow('rate is required');
  });

  it('computes the amount from the sale value and rate', async () => {
    const { service, prisma } = build(goodLead);
    await service.recordCommission({
      leadId: 'lead-1',
      saleValueNaira: 145_000_000,
      ratePercent: 2.5,
    });
    const data = prisma.partnerCommission.create.mock.calls[0][0].data;
    expect(data.amountNaira).toBe(BigInt(3_625_000));
    expect(data.partnerId).toBe('partner-1');
    // Money is BigInt all the way through — Listing.priceNaira is int8 and a
    // Banana Island sale overflows int4.
    expect(typeof data.saleValueNaira).toBe('bigint');
  });
});

describe('PartnerDirectoryService — approving a commission', () => {
  function build(commission: unknown, partnerRow: unknown) {
    const prisma = {
      partnerCommission: {
        findUnique: jest.fn().mockResolvedValue(commission),
        update: jest
          .fn()
          .mockImplementation(({ data }) => ({ id: 'c1', ...data })),
      },
      agentPartner: { findUnique: jest.fn().mockResolvedValue(partnerRow) },
    } as any;
    return { service: new PartnerDirectoryService(prisma), prisma };
  }

  const pending = { id: 'c1', status: 'PENDING', partnerId: 'p1' };

  it('refuses to approve when the partner cannot actually be paid', async () => {
    // Approving something we cannot transfer just moves the failure to the
    // payment run, where it becomes somebody else's confusing error.
    const { service, prisma } = build(
      pending,
      partner({ nin: null, passportPhotoUrl: null }),
    );
    await expect(
      service.decideCommission('c1', 'staff-1', 'APPROVED'),
    ).rejects.toThrow('passport photo');
    expect(prisma.partnerCommission.update).not.toHaveBeenCalled();
  });

  it('approves when the partner is payout ready', async () => {
    const { service, prisma } = build(pending, partner());
    await service.decideCommission('c1', 'staff-1', 'APPROVED');
    const data = prisma.partnerCommission.update.mock.calls[0][0].data;
    expect(data.status).toBe('APPROVED');
    expect(data.approvedByStaffId).toBe('staff-1');
  });

  it('allows rejection regardless of payout details', async () => {
    const { service, prisma } = build(pending, partner({ nin: null }));
    await service.decideCommission('c1', 'staff-1', 'REJECTED');
    expect(prisma.partnerCommission.update).toHaveBeenCalled();
  });

  it.each(['APPROVED', 'PAID', 'REJECTED'])(
    'refuses to decide one that is already %s',
    async (status) => {
      const { service } = build({ ...pending, status }, partner());
      await expect(
        service.decideCommission('c1', 'staff-1', 'APPROVED'),
      ).rejects.toThrow('already');
    },
  );

  it('will not mark an unapproved commission as paid', async () => {
    const prisma = {
      partnerCommission: {
        findUnique: jest.fn().mockResolvedValue({ status: 'PENDING' }),
        update: jest.fn(),
      },
    } as any;
    const service = new PartnerDirectoryService(prisma);
    await expect(service.markPaid('c1')).rejects.toThrow('approved');
    expect(prisma.partnerCommission.update).not.toHaveBeenCalled();
  });
});

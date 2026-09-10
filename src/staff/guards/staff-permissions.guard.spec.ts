import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { StaffPermissionsGuard } from './staff-permissions.guard';
import { StaffPermission, StaffRole } from '../../../generated/prisma/client';

/**
 * The guard is the whole security argument for the team portal, so it is
 * tested for what it REFUSES rather than what it allows.
 */
describe('StaffPermissionsGuard', () => {
  const staffRow = {
    id: 'staff-1',
    userId: 'user-1',
    letter: 'C',
    staffRole: StaffRole.PROPERTY_LISTING,
    chapter: 'LAGOS',
    secondaryChapter: null,
    permissions: [
      StaffPermission.MANAGE_PROPERTIES,
      StaffPermission.MANAGE_DEALS,
    ],
    active: true,
  };

  function build(
    required: StaffPermission[] | undefined,
    profile: typeof staffRow | null,
    user: { id: string } | null = { id: 'user-1' },
  ) {
    const reflector = {
      getAllAndOverride: () => required,
    } as unknown as Reflector;

    const prisma = {
      staffProfile: { findUnique: jest.fn().mockResolvedValue(profile) },
    } as any;

    const request: any = { user };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as any;

    return { guard: new StaffPermissionsGuard(reflector, prisma), ctx, request };
  }

  it('refuses a user with no staff profile', async () => {
    const { guard, ctx } = build([], null);
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(ctx)).rejects.toThrow('Staff access required');
  });

  it('refuses a deactivated staff member', async () => {
    const { guard, ctx } = build([], { ...staffRow, active: false });
    await expect(guard.canActivate(ctx)).rejects.toThrow('deactivated');
  });

  it('refuses when the user is not signed in at all', async () => {
    const { guard, ctx } = build([], staffRow, null);
    await expect(guard.canActivate(ctx)).rejects.toThrow('Not signed in');
  });

  it('allows any active staff member when no permission is required', async () => {
    const { guard, ctx, request } = build([], staffRow);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    // The profile is attached for @CurrentStaff().
    expect(request.staff.id).toBe('staff-1');
  });

  it('allows a permission the profile holds', async () => {
    const { guard, ctx } = build([StaffPermission.MANAGE_PROPERTIES], staffRow);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('refuses a permission the profile lacks, and names it', async () => {
    const { guard, ctx } = build([StaffPermission.APPROVE_WITHDRAWAL], staffRow);
    await expect(guard.canActivate(ctx)).rejects.toThrow('APPROVE_WITHDRAWAL');
  });

  it('requires ALL listed permissions, not any', async () => {
    const { guard, ctx } = build(
      [StaffPermission.MANAGE_PROPERTIES, StaffPermission.REVIEW_KYC],
      staffRow,
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow('REVIEW_KYC');
  });

  it('is NOT bypassed by Role.ADMIN', async () => {
    // The entire reason StaffProfile exists is that ADMIN is one flag
    // covering everything from editing a listing to releasing money. An
    // admin who is not staff has no business in the team portal.
    const { guard, ctx } = build([], null, { id: 'admin-1' } as any);
    await expect(guard.canActivate(ctx)).rejects.toThrow('Staff access required');
  });
});

import { SetMetadata } from '@nestjs/common';
import { StaffPermission } from '../../../generated/prisma/client';

export const STAFF_PERMISSIONS_KEY = 'staffPermissions';

/**
 * Marks a route as staff-only, optionally requiring specific permissions.
 *
 * With no arguments it means "any active staff member". With permissions it
 * means "an active staff member holding ALL of these" — see
 * StaffPermissionsGuard, which is where the check actually happens.
 */
export const RequireStaff = (...permissions: StaffPermission[]) =>
  SetMetadata(STAFF_PERMISSIONS_KEY, permissions);

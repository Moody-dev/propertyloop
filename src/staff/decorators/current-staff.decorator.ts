import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import {
  Chapter,
  StaffPermission,
  StaffRole,
} from '../../../generated/prisma/client';

/** The staff profile StaffPermissionsGuard loaded for this request. */
export interface CurrentStaffData {
  id: string;
  userId: string;
  letter: string;
  staffRole: StaffRole;
  chapter: Chapter;
  secondaryChapter: Chapter | null;
  permissions: StaffPermission[];
  active: boolean;
}

export const CurrentStaff = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentStaffData => {
    const request = ctx.switchToHttp().getRequest();
    return request.staff;
  },
);

/** True when the profile holds the permission. */
export function staffCan(
  staff: CurrentStaffData,
  permission: StaffPermission,
): boolean {
  return staff.permissions.includes(permission);
}

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { STAFF_PERMISSIONS_KEY } from '../decorators/require-staff.decorator';
import { StaffPermission } from '../../../generated/prisma/client';

/**
 * Gates a route on staff membership and specific permissions.
 *
 * Runs AFTER JwtAuthGuard, which puts the user on the request. This loads
 * their StaffProfile, refuses anyone without one, and attaches it as
 * `request.staff` so handlers can read it via @CurrentStaff().
 *
 * Deliberately NOT bypassed by Role.ADMIN. The whole reason this exists is
 * that ADMIN is a single flag covering everything from editing a listing to
 * releasing money — letting it skip the check would rebuild the problem. An
 * admin who is also staff passes on their own permissions; one who is not
 * staff has no business in the team portal.
 */
@Injectable()
export class StaffPermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<StaffPermission[]>(
      STAFF_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException('Not signed in');
    }

    const staff = await this.prisma.staffProfile.findUnique({
      where: { userId: user.id },
      select: {
        id: true,
        userId: true,
        letter: true,
        staffRole: true,
        chapter: true,
        secondaryChapter: true,
        permissions: true,
        active: true,
      },
    });

    if (!staff) {
      throw new ForbiddenException('Staff access required');
    }
    // A deactivated position keeps its history but is no longer somebody who
    // works here, so it must not be able to act.
    if (!staff.active) {
      throw new ForbiddenException('This staff account is deactivated');
    }

    request.staff = staff;

    // @RequireStaff() with no arguments means "any active staff member".
    if (!required || required.length === 0) {
      return true;
    }

    const missing = required.filter((p) => !staff.permissions.includes(p));
    if (missing.length > 0) {
      throw new ForbiddenException(`Missing permission: ${missing.join(', ')}`);
    }

    return true;
  }
}

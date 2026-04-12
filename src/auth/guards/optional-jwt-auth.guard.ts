import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Like JwtAuthGuard but does not throw when no token is present.
 * Sets req.user if a valid token is supplied, otherwise leaves it undefined.
 * Useful for endpoints that work for both guests and authenticated users
 * (e.g. leaving a review, submitting a lead).
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(err: any, user: any) {
    // Never throw — return user if present, otherwise undefined.
    if (err || !user) return undefined;
    return user;
  }
}

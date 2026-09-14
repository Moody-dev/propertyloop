import { Throttle } from '@nestjs/throttler';

/**
 * Rate limit for the staff portal's routes.
 *
 * The global limit is 30 requests a minute per IP, which suits public and
 * sign-in endpoints. It does not suit the portal: opening it reads a dozen
 * collections at once, and the whole team works from one office connection,
 * so seven people arriving at 9am would share one 30-request budget and lock
 * each other out.
 *
 * Every route this applies to already requires a signed-in staff account, so
 * the abuse the global limit guards against is not reachable here without
 * valid staff credentials. A higher ceiling still stops a runaway client loop.
 */
export const StaffThrottle = () =>
  Throttle({ default: { limit: 600, ttl: 60_000 } });

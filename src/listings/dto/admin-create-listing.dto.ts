import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ListingStatus } from '../../../generated/prisma/client';
import { CreateListingDto } from './create-listing.dto';

/**
 * Admin-side listing creation. Reuses every field an agent supplies when
 * creating a listing, but adds the two things the admin context needs that
 * the agent flow derives implicitly:
 *  - `agentId`: which agent the listing belongs to (an admin is not an agent,
 *    so the owner can't be taken from the authenticated user).
 *  - `status`: admins create listings on behalf of agents and can publish them
 *    directly or queue them for review, instead of the agent default.
 *  - `sourcedByStaffId`: which staff member brought the listing in. agentId
 *    records who OWNS it, which is a different question — without this,
 *    "Ola listed 14 properties this month" cannot be answered from the
 *    database at all.
 */
export class AdminCreateListingDto extends CreateListingDto {
  @IsString()
  @IsNotEmpty()
  agentId: string;

  @IsEnum(ListingStatus)
  @IsOptional()
  status?: ListingStatus;

  /** The StaffProfile id of whoever sourced this listing. */
  @IsString()
  @IsOptional()
  sourcedByStaffId?: string;

  /** The mandate this property arrived through, if any. */
  @IsString()
  @IsOptional()
  fromDealId?: string;
}

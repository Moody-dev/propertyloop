/**
 * Marketplace money rules — single source of truth for both order creation and
 * webhook reconciliation, so the amount we charge always matches the amount we
 * verify.
 */

// Buyer-facing service fee, added on top of the cart subtotal. Distinct from
// the vendor commission below: this is paid by the buyer, that is deducted from
// the vendor's payout.
export const BUYER_PLATFORM_FEE_PCT = 1.5;

// Default commission PropertyLoop takes from a store's sales. Stores can be
// given a better rate via MarketplaceStore.commissionPct.
export const DEFAULT_COMMISSION_PCT = 7;

// Free delivery once the subtotal clears this; otherwise a flat fee applies.
export const FREE_DELIVERY_THRESHOLD = 250_000;
export const FLAT_DELIVERY_FEE = 5_000;

/** Buyer-facing platform fee for a given subtotal, in whole naira. */
export function platformFeeFor(subtotalNaira: number): number {
  return Math.round(subtotalNaira * (BUYER_PLATFORM_FEE_PCT / 100));
}

/** Delivery fee for a given subtotal, in whole naira. */
export function deliveryFeeFor(subtotalNaira: number): number {
  if (subtotalNaira <= 0) return 0;
  return subtotalNaira >= FREE_DELIVERY_THRESHOLD ? 0 : FLAT_DELIVERY_FEE;
}

/** Commission owed to PropertyLoop on a line total, in whole naira. */
export function commissionFor(lineTotalNaira: number, pct: number): number {
  return Math.round(lineTotalNaira * (pct / 100));
}

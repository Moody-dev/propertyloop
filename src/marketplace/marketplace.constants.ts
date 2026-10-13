/**
 * Marketplace money rules — single source of truth for both order creation and
 * webhook reconciliation, so the amount we charge always matches the amount we
 * verify.
 */

// Buyer-facing service fee, added on top of the cart subtotal. Distinct from
// the vendor commission below: this is paid by the buyer, that is deducted from
// the vendor's payout.
export const BUYER_PLATFORM_FEE_PCT = 1.5;

// Commission PropertyLoop takes from a store's sales, by product category.
// These are the starting rates in the marketplace architecture: the rate is
// resolved per line from the product's category, so one cart can carry several
// rates. A store can be given a negotiated rate that overrides all of these
// (MarketplaceStore.commissionPctOverride).
export const DEFAULT_COMMISSION_PCT = 7;

export const CATEGORY_COMMISSION_PCT: Record<string, number> = {
  // Building & construction materials
  'building materials': 5,
  // Home & interior / décor
  'home & interior': 7,
  'home & decor': 7,
  'home & décor': 7,
  'lighting & decor': 7,
  lighting: 7,
  decor: 7,
  'home & living': 7,
  // Furniture
  furniture: 7,
  // Electronics / appliances
  electronics: 5,
  appliances: 5,
  'electronics & appliances': 5,
  'smart home': 5,
  // Professional & construction services
  'professional services': 10,
  'construction services': 10,
  'property services': 10,
  services: 10,
};

/**
 * The commission rate that applies to a single line.
 *
 * A negotiated per-store override wins over everything. Otherwise the rate is
 * looked up from the product category (case-insensitive, trimmed); anything
 * unrecognised falls back to the default. Returned as a whole-number percent.
 */
export function resolveCommissionPct(
  category: string | null | undefined,
  storeOverridePct?: number | null,
): number {
  if (storeOverridePct !== null && storeOverridePct !== undefined) {
    return storeOverridePct;
  }
  const key = (category ?? '').trim().toLowerCase();
  return CATEGORY_COMMISSION_PCT[key] ?? DEFAULT_COMMISSION_PCT;
}

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

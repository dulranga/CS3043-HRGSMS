/**
 * Shared money helpers for the LKR `numeric` columns in this project.
 *
 * Member 2 and Member 3 both store rates and prices as PostgreSQL `numeric`,
 * which `pg` returns as exact strings such as `'1250.50'`. Those strings are
 * kept intact all the way to the DOM: parsing into a binary float would let
 * rounding drift into displayed charges, so formatting works on the text.
 */

/** `numeric(12,2)` scale: non-negative with at most two decimal places. */
export const MONEY_PATTERN = /^\d+(\.\d{1,2})?$/;

/**
 * `numeric(10,2)` scale for service-usage quantity, which must also be
 * strictly positive (M3-S04 / FR-045).
 */
export const QUANTITY_PATTERN = /^\d+(\.\d{1,2})?$/;

export function toMoneyString(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '0.00';
  const text = String(value).trim();
  if (!text) return '0.00';
  if (!MONEY_PATTERN.test(text)) {
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed.toFixed(2) : '0.00';
  }
  const [whole, fraction = ''] = text.split('.');
  return `${whole}.${fraction.padEnd(2, '0')}`;
}

export function formatLkr(value: string | number | null | undefined): string {
  const money = toMoneyString(value);
  const [whole, fraction] = money.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `LKR ${grouped}.${fraction}`;
}

/**
 * Sums exact `numeric(12,2)` strings without floating point. Amounts are kept
 * as integer minor units (hundredths of a rupee) so FR-050's subtotal stays
 * exact.
 */
export function sumMoney(values: Array<string | number | null | undefined>): string {
  let minorUnits = 0n;
  for (const value of values) {
    minorUnits += toMinorUnits(value);
  }
  return minorUnitsToString(minorUnits);
}

/**
 * `numeric(10,2) x numeric(12,2)` kept in exact hundredths, per FR-046. M3-S10
 * computes the stored amount with PostgreSQL `ROUND(quantity *
 * unit_price_snapshot, 2)`, so this rounds half up in the same way rather than
 * truncating what the server would store.
 */
export function multiplyMoney(quantity: string | number, unitPrice: string | number): string {
  const product = toMinorUnits(quantity) * toMinorUnits(unitPrice);
  return minorUnitsToString((product + 50n) / 100n);
}

function toMinorUnits(value: string | number | null | undefined): bigint {
  const [whole, fraction = ''] = toMoneyString(value).split('.');
  return BigInt(whole) * 100n + BigInt(fraction);
}

function minorUnitsToString(minorUnits: bigint): string {
  const whole = minorUnits / 100n;
  const fraction = minorUnits % 100n;
  return `${whole}.${fraction.toString().padStart(2, '0')}`;
}
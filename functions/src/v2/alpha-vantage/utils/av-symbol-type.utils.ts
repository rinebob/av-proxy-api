/**
 * Pure utility helpers for classifying Alpha Vantage symbol types.
 *
 * These are simple string checks against the `type` field returned by AV
 * SYMBOL_SEARCH (e.g., "Equity", "ETF", "Common Stock").
 */

/**
 * Returns true when the supplied symbol type is considered an equity/security
 * for which Alpha Vantage Company Overview is meaningful.
 */
export function isEquitySymbol(symbolType: string | undefined | null): boolean {
  if (!symbolType) {
    return false;
  }
  const type = symbolType.toLowerCase();
  return type.includes('equity') || type.includes('stock') || type.includes('common');
}

import type { OptionType } from '../../partner/spread-request.types';

/**
 * Constructs an OCC-style contract ID from leg parameters.
 *
 * Format: `{SYMBOL}{YYMMDD}{C|P}{STRIKE×1000 padded to 8 digits}`
 *
 * Example: QQQ, 2024-07-19, call, strike 450 → `QQQ240719C00450000`
 *
 * This is the inverse of `parseContractIDMetadata` in `contract-metadata.utils.ts`.
 */
export function buildContractID(
  symbol: string,
  expiration: string,
  optionType: OptionType,
  strike: number,
): string {
  const sym = symbol.toUpperCase();
  const datePart = expiration.slice(2).replace(/-/g, '');
  const typeCode = optionType === 'call' ? 'C' : 'P';
  const strikePart = Math.round(strike * 1000).toString().padStart(8, '0');

  return `${sym}${datePart}${typeCode}${strikePart}`;
}

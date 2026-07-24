import type { Bucket } from '@google-cloud/storage';

import { isValidIsoDate } from '../../common/utils/date-time.utils';
import { getTimeSeriesObjectPath } from './gcs-time-series-path.utils';

export interface ContractMetadata {
  expiration: string;
  type: 'call' | 'put';
  strike: string;
}

/**
 * Parses an OCC-style contractID into expiration, type, and strike.
 *
 * Format: `{SYMBOL}{YYMMDD}{C|P}{8DIGIT_STRIKE}` where the strike is
 * encoded in 1/1000 of a dollar and padded with leading zeros.
 */
export function parseContractIDMetadata(symbol: string, contractID: string): ContractMetadata | null {
  const sym = symbol.toUpperCase();
  const id = contractID.toUpperCase();
  if (!id.startsWith(sym)) return null;

  const suffix = id.slice(sym.length);
  if (suffix.length < 6 + 1 + 8) return null;

  const datePart = suffix.slice(0, 6);
  const typeCode = suffix.slice(6, 7);
  const strikePart = suffix.slice(7, 15);

  const expiration = `20${datePart.slice(0, 2)}-${datePart.slice(2, 4)}-${datePart.slice(4, 6)}`;
  if (!isValidIsoDate(expiration)) return null;

  const type = typeCode === 'C' ? 'call' : typeCode === 'P' ? 'put' : null;
  if (!type) return null;

  const strikeNumeric = Number(strikePart);
  if (!Number.isFinite(strikeNumeric) || strikeNumeric < 0) return null;

  return { expiration, type, strike: (strikeNumeric / 1000).toString() };
}

/**
 * Resolves contract metadata from the contractID, falling back to GCS
 * custom metadata when the contractID cannot be parsed.
 */
export async function resolveContractMetadata(
  symbol: string,
  contractID: string,
  bucket: Bucket,
): Promise<ContractMetadata | null> {
  const parsed = parseContractIDMetadata(symbol, contractID);
  if (parsed) return parsed;

  try {
    const [meta] = await bucket.file(getTimeSeriesObjectPath(symbol, contractID)).getMetadata();
    const custom = meta?.metadata ?? {};
    const expiration = typeof custom.expiration === 'string' ? custom.expiration : undefined;
    const type = custom.type === 'call' || custom.type === 'put' ? custom.type : undefined;
    const strike = typeof custom.strike === 'string' ? custom.strike : undefined;
    if (expiration && type && strike) {
      return { expiration, type, strike };
    }
  } catch {
    // Object does not exist or metadata is unavailable.
  }

  return null;
}

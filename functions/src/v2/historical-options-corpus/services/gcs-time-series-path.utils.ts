import { TIME_SERIES_PREFIX } from '../types';

/**
 * Builds the canonical GCS object path for a per-contract historical
 * options time series JSONL file.
 */
export function getTimeSeriesObjectPath(
  symbol: string,
  contractID: string,
  prefix = TIME_SERIES_PREFIX,
): string {
  return `${prefix}/${symbol.toUpperCase()}/${contractID.toUpperCase()}.jsonl`;
}

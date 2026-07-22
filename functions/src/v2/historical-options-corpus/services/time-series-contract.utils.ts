import type { AvOptionContract } from '@shared/alpha-vantage';

/**
 * Compact, alias-keyed record stored in a per-contract JSONL object.
 * Each field name is one or two characters to keep file sizes small and
 * GCS reads fast. The API expands aliases back to full names.
 */
export interface TimeSeriesStorageRecord {
  d: string;
  l?: string;
  m?: string;
  b?: string;
  bs?: string;
  a?: string;
  as?: string;
  v?: string;
  oi?: string;
  iv?: string;
  de?: string;
  g?: string;
  t?: string;
  ve?: string;
  r?: string;
}

/**
 * Consumer-facing observation shape. Field names match the normalized
 * Alpha Vantage contract fields returned by `partnerHistoricalOptionsV2`.
 */
export interface TimeSeriesApiObservation {
  date: string;
  last?: string;
  mark?: string;
  bid?: string;
  bid_size?: string;
  ask?: string;
  ask_size?: string;
  volume?: string;
  open_interest?: string;
  implied_volatility?: string;
  delta?: string;
  gamma?: string;
  theta?: string;
  vega?: string;
  rho?: string;
}

const apiToStorage: Array<[keyof AvOptionContract, keyof TimeSeriesStorageRecord]> = [
  ['date', 'd'],
  ['last', 'l'],
  ['mark', 'm'],
  ['bid', 'b'],
  ['bid_size', 'bs'],
  ['ask', 'a'],
  ['ask_size', 'as'],
  ['volume', 'v'],
  ['open_interest', 'oi'],
  ['implied_volatility', 'iv'],
  ['delta', 'de'],
  ['gamma', 'g'],
  ['theta', 't'],
  ['vega', 've'],
  ['rho', 'r'],
];

const aliasToFull: Array<[keyof TimeSeriesStorageRecord, keyof TimeSeriesApiObservation]> = [
  ['d', 'date'],
  ['l', 'last'],
  ['m', 'mark'],
  ['b', 'bid'],
  ['bs', 'bid_size'],
  ['a', 'ask'],
  ['as', 'ask_size'],
  ['v', 'volume'],
  ['oi', 'open_interest'],
  ['iv', 'implied_volatility'],
  ['de', 'delta'],
  ['g', 'gamma'],
  ['t', 'theta'],
  ['ve', 'vega'],
  ['r', 'rho'],
];

const storageFieldOrder: (keyof TimeSeriesStorageRecord)[] = [
  'd',
  'l',
  'm',
  'b',
  'bs',
  'a',
  'as',
  'v',
  'oi',
  'iv',
  'de',
  'g',
  't',
  've',
  'r',
];

/**
 * Converts a normalized AV option contract into a compact storage record.
 * Returns undefined when the contract has no `date`, which makes it unusable
 * for a time series.
 */
export function toStorageRecord(contract: AvOptionContract): TimeSeriesStorageRecord | undefined {
  if (!contract.date) return undefined;

  const record: Partial<TimeSeriesStorageRecord> & { d: string } = { d: contract.date };
  for (const [fullKey, alias] of apiToStorage) {
    const value = contract[fullKey];
    if (typeof value === 'string' && value !== '') {
      record[alias] = value;
    }
  }

  return record;
}

/**
 * Serializes a storage record to a single JSONL line with a deterministic
 * field order. Omitted fields are left out entirely.
 */
export function toStorageLine(record: TimeSeriesStorageRecord): string {
  const ordered: Partial<TimeSeriesStorageRecord> = {};
  for (const key of storageFieldOrder) {
    const value = record[key];
    if (value !== undefined) {
      ordered[key] = value;
    }
  }
  return JSON.stringify(ordered);
}

/**
 * Parses a JSONL line. Returns undefined when the line is not valid JSON or
 * does not contain a `d` (date) string.
 */
export function parseStorageLine(line: string): TimeSeriesStorageRecord | undefined {
  try {
    const parsed = JSON.parse(line);
    if (typeof parsed !== 'object' || parsed === null || typeof parsed.d !== 'string') {
      return undefined;
    }

    const record: Partial<TimeSeriesStorageRecord> & { d: string } = { d: parsed.d };
    for (const [alias] of aliasToFull) {
      if (alias === 'd') continue;
      const value = parsed[alias];
      if (typeof value === 'string') {
        record[alias] = value;
      }
    }
    return record;
  } catch {
    return undefined;
  }
}

/**
 * Expands a compact storage record into the full-field API observation shape.
 */
export function toApiObservation(record: TimeSeriesStorageRecord): TimeSeriesApiObservation {
  const observation: Partial<TimeSeriesApiObservation> & { date: string } = { date: record.d };
  for (const [alias, full] of aliasToFull) {
    if (alias === 'd') continue;
    const value = record[alias];
    if (typeof value === 'string' && value !== '') {
      observation[full] = value;
    }
  }
  return observation;
}

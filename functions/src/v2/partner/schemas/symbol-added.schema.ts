import { TimeSeriesInterval } from '@shared/alpha-vantage';

/**
 * Payload for the `partner-symbol-added` Pub/Sub channel.
 */
export interface SymbolAddedPayloadV1 {
  version: 'v1';
  symbols: string[];
  addedAtUTC: string;
  status: 'ready';
  availableIntervals: TimeSeriesInterval[];
}

/**
 * Validates that a payload conforms to the partner-symbol-added v1 contract.
 *
 * Throws if the payload is structurally invalid. This is intentionally strict
 * so consumers receive a consistent message shape.
 */
export function validateSymbolAddedPayload(payload: unknown): SymbolAddedPayloadV1 {
  if (!payload || typeof payload !== 'object') {
    throw new Error('SymbolAddedPayloadV1 must be an object');
  }

  const p = payload as Partial<SymbolAddedPayloadV1>;

  if (p.version !== 'v1') {
    throw new Error(`Unsupported SymbolAddedPayloadV1 version: ${p.version}`);
  }

  if (p.status !== 'ready') {
    throw new Error(`Unsupported SymbolAddedPayloadV1 status: ${p.status}`);
  }

  if (!Array.isArray(p.symbols) || p.symbols.length === 0 || !p.symbols.every((s) => typeof s === 'string' && s.length > 0)) {
    throw new Error('SymbolAddedPayloadV1.symbols must be a non-empty array of non-empty strings');
  }

  if (typeof p.addedAtUTC !== 'string' || !p.addedAtUTC) {
    throw new Error('SymbolAddedPayloadV1.addedAtUTC must be a non-empty ISO-8601 string');
  }

  const validIntervals = Object.values(TimeSeriesInterval);
  if (
    !Array.isArray(p.availableIntervals) ||
    p.availableIntervals.length === 0 ||
    !p.availableIntervals.every((interval) => validIntervals.includes(interval as TimeSeriesInterval))
  ) {
    throw new Error(`SymbolAddedPayloadV1.availableIntervals must be a non-empty array of ${validIntervals.join(', ')}`);
  }

  return p as SymbolAddedPayloadV1;
}

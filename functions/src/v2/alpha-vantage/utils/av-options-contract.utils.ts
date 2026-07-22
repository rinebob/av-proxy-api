import { AvOptionContract, AvOptionType } from '@shared/alpha-vantage';

/**
 * Normalizes a raw Alpha Vantage option metric into a trimmed string.
 * Returns `undefined` for null, undefined, empty, whitespace-only, or
 * non-finite numeric values.
 */
export function normalizeAvNumericString(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === 'string' && !value.trim()) {
    return undefined;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? String(value).trim() : undefined;
}

/**
 * Normalizes a raw Alpha Vantage option contract into a typed contract.
 *
 * @throws {Error} If the contract payload is null or undefined.
 */
export function normalizeAvOptionContract(contract: unknown): AvOptionContract {
  if (!contract || typeof contract !== 'object') {
    throw new Error('Contract data is required');
  }

  const source = contract as Record<string, unknown>;

  const normalized: AvOptionContract = {
    contractID: typeof source.contractID === 'string' ? source.contractID : undefined,
    symbol: typeof source.symbol === 'string' ? source.symbol : undefined,
    expiration: typeof source.expiration === 'string' ? source.expiration : undefined,
    strike: normalizeAvNumericString(source.strike),
    type: source.type === AvOptionType.CALL || source.type === AvOptionType.PUT
      ? (source.type as AvOptionType)
      : undefined,
    last: normalizeAvNumericString(source.last),
    mark: normalizeAvNumericString(source.mark),
    bid: normalizeAvNumericString(source.bid),
    bid_size: normalizeAvNumericString(source.bid_size),
    ask: normalizeAvNumericString(source.ask),
    ask_size: normalizeAvNumericString(source.ask_size),
    volume: normalizeAvNumericString(source.volume),
    open_interest: normalizeAvNumericString(source.open_interest),
    date: typeof source.date === 'string' ? source.date : undefined,
    implied_volatility: normalizeAvNumericString(source.implied_volatility),
    delta: normalizeAvNumericString(source.delta),
    gamma: normalizeAvNumericString(source.gamma),
    theta: normalizeAvNumericString(source.theta),
    vega: normalizeAvNumericString(source.vega),
    rho: normalizeAvNumericString(source.rho),
  };

  return normalized;
}

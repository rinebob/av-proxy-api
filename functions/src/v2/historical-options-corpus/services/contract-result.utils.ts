import type { ContractResult } from '@shared/options';

import { parseContractIDMetadata } from './contract-metadata.utils';

/**
 * Parses an OCC contract ID into a {@link ContractResult} using the canonical
 * `parseContractIDMetadata` utility. Returns `null` if the contract ID is invalid.
 *
 * The strike value from `parseContractIDMetadata` is already in dollars — no
 * additional division is needed.
 */
export function parseContractResult(symbol: string, contractId: string): ContractResult | null {
  const meta = parseContractIDMetadata(symbol, contractId);
  if (!meta) return null;

  const strikeNumeric = Number(meta.strike);
  if (!Number.isFinite(strikeNumeric)) return null;

  return {
    contractId: contractId.toUpperCase(),
    expiration: meta.expiration,
    strike: strikeNumeric,
    type: meta.type,
  };
}

/**
 * Filters a list of contract IDs by option type, returning parsed
 * {@link ContractResult} objects. Contracts that fail parsing are skipped.
 *
 * @param type Filter by `'C'` (call) or `'P'` (put). `null`/`undefined` returns all.
 */
export function filterContractsByType(
  contractIds: string[],
  symbol: string,
  type?: 'C' | 'P' | null,
): ContractResult[] {
  const contracts: ContractResult[] = [];
  for (const id of contractIds) {
    const parsed = parseContractResult(symbol, id);
    if (!parsed) continue;
    if (type) {
      const expectedType = type === 'C' ? 'call' : 'put';
      if (parsed.type !== expectedType) continue;
    }
    contracts.push(parsed);
  }
  return contracts;
}

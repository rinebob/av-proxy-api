/**
 * Request-param parsing for `partnerContractAvailabilityV1`.
 *
 * Pure functions — no I/O. Normalizes Express query values into
 * {@link ContractAvailabilityFilters} or a descriptive error string.
 */

import type { ContractAvailabilityFilters } from '@shared/options';

import {
  toFirstString,
  parseOptionalDate,
  parseOptionalNonNegativeNumber,
  parseOptionalNumber,
  parseOptionalDateList,
  parseOptionType,
} from './partner-request.utils';
import { SYMBOL_PATTERN } from './historical-options-request.utils';

export type ContractAvailabilityQueryResult =
  | { ok: true; params: ContractAvailabilityFilters }
  | { ok: false; error: string };

const EXPIRATIONS_ERROR = 'Invalid expirations — expected comma-separated YYYY-MM-DD dates';

/**
 * Normalizes a scalar query value: strings trimmed, first element of arrays,
 * numbers coerced. `undefined` = absent (or empty string); `''` = provided
 * but unusable (object/boolean/etc.) — callers must treat it as invalid
 * rather than silently dropping the param.
 */
function rawScalar(value: unknown): string | undefined {
  if (Array.isArray(value)) value = value[0];
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    const t = value.trim();
    return t === '' ? undefined : t;
  }
  if (typeof value === 'number') return String(value);
  return '';
}

function parseRequiredDate(raw: string, name: string): string | { error: string } {
  const parsed = parseOptionalDate(raw);
  return parsed ?? { error: `Invalid ${name} — expected YYYY-MM-DD` };
}

function parseRequiredNumber(raw: string, name: string): number | { error: string } {
  const parsed = parseOptionalNonNegativeNumber(raw);
  return parsed ?? { error: `Invalid ${name} — expected a non-negative number` };
}

function isError(v: unknown): v is { error: string } {
  return typeof v === 'object' && v !== null && 'error' in v;
}

/**
 * Parses the availability endpoint's query params.
 *
 * `expirations` overrides `expirationGte`/`expirationLte` — when the explicit
 * list is present the range fields are dropped from the result.
 * Range pairs are validated (gte <= lte); `strikeStep` must be > 0.
 */
export function parseContractAvailabilityQuery(query: Record<string, unknown>): ContractAvailabilityQueryResult {
  const symbol = toFirstString(query.symbol).toUpperCase();
  if (!symbol || !SYMBOL_PATTERN.test(symbol)) {
    return { ok: false, error: 'Invalid or missing symbol' };
  }

  const params: ContractAvailabilityFilters = { symbol };

  const dateParams = ['expirationGte', 'expirationLte', 'firstObservedGte', 'firstObservedLte'] as const;
  for (const name of dateParams) {
    const raw = rawScalar(query[name]);
    if (raw === undefined) continue;
    const v = parseRequiredDate(raw, name);
    if (isError(v)) return { ok: false, error: v.error };
    params[name] = v;
  }

  let expirations: string[] | undefined;
  const expirationsRaw = rawScalar(query.expirations);
  if (expirationsRaw !== undefined) {
    const list = parseOptionalDateList(expirationsRaw);
    if (list === null) return { ok: false, error: EXPIRATIONS_ERROR };
    expirations = list;
  }

  for (const name of ['strikeGte', 'strikeLte'] as const) {
    const raw = rawScalar(query[name]);
    if (raw === undefined) continue;
    const v = parseRequiredNumber(raw, name);
    if (isError(v)) return { ok: false, error: v.error };
    params[name] = v;
  }

  const stepRaw = rawScalar(query.strikeStep);
  if (stepRaw !== undefined) {
    const step = parseOptionalNumber(stepRaw);
    if (step === null || step <= 0) {
      return { ok: false, error: 'Invalid strikeStep — expected a positive number' };
    }
    params.strikeStep = step;
  }

  const typeRaw = rawScalar(query.type);
  if (typeRaw !== undefined) {
    const type = parseOptionType(typeRaw);
    if (type === null) return { ok: false, error: 'Invalid type — expected C, P, call, or put' };
    params.type = type;
  }

  if (params.expirationGte && params.expirationLte && params.expirationGte > params.expirationLte) {
    return { ok: false, error: 'expirationGte must be <= expirationLte' };
  }
  if (params.strikeGte !== undefined && params.strikeLte !== undefined && params.strikeGte > params.strikeLte) {
    return { ok: false, error: 'strikeGte must be <= strikeLte' };
  }
  if (params.firstObservedGte && params.firstObservedLte && params.firstObservedGte > params.firstObservedLte) {
    return { ok: false, error: 'firstObservedGte must be <= firstObservedLte' };
  }

  // Range params are fully validated above; only now does the explicit
  // `expirations` list override them.
  if (expirations !== undefined) {
    params.expirations = expirations;
    delete params.expirationGte;
    delete params.expirationLte;
  }

  return { ok: true, params };
}

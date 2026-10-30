/**
 * Shared request parsing utilities for partner endpoint handlers.
 *
 * These functions are pure — no I/O, no side effects.  They normalize
 * Express query-string values into typed values or `null` when invalid.
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Extracts the first value from an Express query param (which may be a
 * string or string array) and trims it.
 */
export function toFirstString(value: unknown): string {
  if (Array.isArray(value)) {
    value = value[0];
  }
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Parses an optional `YYYY-MM-DD` date query param.
 * Returns the validated ISO date string, or `null` when absent or invalid.
 */
export function parseOptionalDate(value: unknown): string | null {
  const raw = toFirstString(value);
  if (!raw) return null;
  if (!DATE_PATTERN.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) return null;
  return raw;
}

/**
 * Parses an optional numeric query param.
 * Returns the finite number, or `null` when absent or non-finite.
 */
export function parseOptionalNumber(value: unknown): number | null {
  const raw = toFirstString(value);
  if (!raw) return null;
  const num = Number(raw);
  if (!Number.isFinite(num)) return null;
  return num;
}

/**
 * Parses an optional non-negative numeric query param.
 * Returns the finite non-negative number, or `null` when absent, non-finite, or negative.
 */
export function parseOptionalNonNegativeNumber(value: unknown): number | null {
  const num = parseOptionalNumber(value);
  if (num === null) return null;
  if (num < 0) return null;
  return num;
}

/**
 * Parses an optional boolean query param (`true` or `1`).
 */
export function parseOptionalBool(value: unknown): boolean {
  const raw = toFirstString(value).toLowerCase();
  return raw === 'true' || raw === '1';
}

/**
 * Parses an optional comma-separated date-list query param (e.g.
 * `expirations=2026-05-15,2026-06-19`). Each element must be a valid
 * `YYYY-MM-DD` calendar date. Duplicates are removed; the result is in
 * canonical ascending order.
 * Returns the date list, or `null` when absent or any element is invalid.
 */
export function parseOptionalDateList(value: unknown): string[] | null {
  const raw = toFirstString(value);
  if (!raw) return null;
  const parts = raw.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  const dates = new Set<string>();
  for (const part of parts) {
    const parsed = parseOptionalDate(part);
    if (parsed === null) return null;
    dates.add(parsed);
  }
  return [...dates].sort();
}

const OPTION_TYPE_TOKENS: Record<string, 'call' | 'put'> = {
  C: 'call',
  P: 'put',
  CALL: 'call',
  PUT: 'put',
};

/**
 * Parses an option-type query param (`C`/`P`, and when `acceptWords` also
 * `call`/`put`), case-insensitive, normalized to `call | put`.
 * Returns `null` when absent or invalid.
 */
export function parseOptionType(value: unknown, acceptWords = true): 'call' | 'put' | null {
  const raw = toFirstString(value).toUpperCase();
  if (!raw) return null;
  if (!acceptWords && (raw === 'CALL' || raw === 'PUT')) return null;
  return OPTION_TYPE_TOKENS[raw] ?? null;
}

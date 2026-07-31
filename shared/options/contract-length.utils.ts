/**
 * Contract length classifier.
 *
 * Maps a calendar-day span (expiration date − first observed date) to a
 * human-readable length label.  The label is always >= the actual number
 * of days, so e.g. a 2-day span maps to "3d", not "1d".
 */

interface LengthBucket {
  label: string;
  /** Inclusive upper bound in calendar days. */
  maxDays: number;
}

/** Ordered buckets — first match wins. */
const LENGTH_BUCKETS: ReadonlyArray<LengthBucket> = [
  { label: '1d', maxDays: 1 },
  { label: '3d', maxDays: 3 },
  { label: '5d', maxDays: 5 },
  { label: '7d', maxDays: 7 },
  { label: '14d', maxDays: 14 },
  { label: '21d', maxDays: 21 },
  { label: '1mo', maxDays: 31 },
  { label: '1.5mo', maxDays: 42 },
  { label: '2mo', maxDays: 60 },
  { label: '3mo', maxDays: 91 },
  { label: '4mo', maxDays: 122 },
  { label: '6mo', maxDays: 183 },
  { label: '9mo', maxDays: 274 },
  { label: '1yr', maxDays: 365 },
  { label: '2yr', maxDays: 730 },
  { label: '3yr', maxDays: Number.MAX_SAFE_INTEGER },
];

/** Ordered list of bucket labels, shortest to longest. */
export const LENGTH_BUCKET_LABELS: ReadonlyArray<string> = LENGTH_BUCKETS.map((b) => b.label);

/** Set of valid length bucket labels, derived from LENGTH_BUCKETS. */
export const VALID_LENGTH_BUCKETS: ReadonlySet<string> = new Set(LENGTH_BUCKET_LABELS);

/** Zero-based chronological sort index for each bucket label. */
export const LENGTH_BUCKET_SORT_INDEX: ReadonlyMap<string, number> = new Map(
  LENGTH_BUCKET_LABELS.map((label, idx) => [label, idx]),
);

/**
 * Classifies a calendar-day span into a length label.
 *
 * @param calendarDays - Number of days between firstObserved and expiration.
 * @returns Length label (e.g. "3mo"), or "—" for negative/invalid input.
 */
export function classifyContractLength(calendarDays: number): string {
  if (!Number.isFinite(calendarDays) || calendarDays < 0) return '—';
  for (const bucket of LENGTH_BUCKETS) {
    if (calendarDays <= bucket.maxDays) return bucket.label;
  }
  return '3yr';
}

/**
 * Parses an ISO date string (e.g. "2025-10-15") into a UTC Date at midnight.
 *
 * @returns A `Date` at `T00:00:00.000Z`, or `null` if the input is invalid.
 */
export function parseIsoDate(dateStr: string): Date | null {
  const ms = Date.parse(`${dateStr}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms);
}

/**
 * Short weekday abbreviation from an ISO date string (e.g. "2026-01-15" → "Thu").
 */
export function dayOfWeek(dateStr: string): string {
  const dt = parseIsoDate(dateStr);
  if (!dt) return '';
  return dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}

/**
 * Formats a date with day-of-week: "2026-01-15 (Thu)".
 */
export function formatDateWithDow(dateStr: string): string {
  const dow = dayOfWeek(dateStr);
  return dow ? `${dateStr} (${dow})` : dateStr;
}

/**
 * Computes inclusive calendar days between two ISO date strings (end − start + 1).
 *
 * # Reason: A contract first observed on Jan 2 and expiring Jan 4 spans
 * 3 calendar days (Jan 2, 3, 4), not 2. The inclusive count matches
 * `expectedObservationCount` semantics and gives correct length buckets.
 *
 * @param startDate - ISO date (e.g. "2025-10-15")
 * @param endDate - ISO date (e.g. "2026-01-15")
 * @returns Whole number of calendar days (inclusive), or null if either date is invalid.
 */
export function calendarDaysBetween(startDate: string, endDate: string): number | null {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (!start || !end) return null;
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

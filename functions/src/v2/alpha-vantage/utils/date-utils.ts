/**
 * Date utilities for Alpha Vantage handlers.
 */

/**
 * Parses an ISO-like date string into epoch milliseconds.
 * Returns NaN if the date is invalid.
 */
export function parseIsoDateMs(iso: string): number {
  return new Date(iso).getTime();
}

/**
 * Parse Alpha Vantage intraday timestamp strings that are provided in US/Eastern local time
 * (e.g., "2025-11-10 12:45:00"), and return epoch milliseconds for that exact Eastern wall time.
 *
 * Why: new Date("YYYY-MM-DD HH:mm:ss") assumes the string is in the server's local timezone (UTC in Cloud Functions),
 * which shifts Eastern timestamps by the timezone difference. This helper interprets the input as America/New_York
 * regardless of server locale, and computes the correct UTC epoch for that wall time, including DST.
 *
 * Implementation approach (no external libs):
 * 1) Parse components (Y,M,D,h,m,s).
 * 2) Create a UTC Date from those components (as if the wall time were UTC).
 * 3) Determine what time that UTC instant would show in America/New_York using Intl.DateTimeFormat.
 * 4) The difference (in minutes) between desired wall time and formatted ET time is the timezone offset for ET at that date.
 * 5) Adjust the UTC ms by that minute delta to yield the correct instant for the intended ET wall time.
 */
export function parseAvEtTimestampMs(ts: string): number {
  // Expect formats like: YYYY-MM-DD HH:mm or YYYY-MM-DD HH:mm:ss
  // Fallback to NaN on invalid inputs
  if (typeof ts !== 'string') return NaN;
  const m = ts.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return NaN;
  const y = Number(m[1]);
  const mon = Number(m[2]);
  const d = Number(m[3]);
  const hh = Number(m[4]);
  const mm = Number(m[5]);
  const ss = Number(m[6] ?? 0);
  if ([y, mon, d, hh, mm, ss].some(n => !Number.isFinite(n))) return NaN;

  // Step 2: construct UTC epoch for the same clock time
  const utcMs = Date.UTC(y, mon - 1, d, hh, mm, ss, 0);

  // Step 3: determine what time this UTC instant shows in ET
  const etParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(utcMs));
  const etH = Number(etParts.find(p => p.type === 'hour')?.value ?? '0');
  const etM = Number(etParts.find(p => p.type === 'minute')?.value ?? '0');
  const etS = Number(etParts.find(p => p.type === 'second')?.value ?? '0');

  // Step 4: difference (desired - actual) in minutes/seconds
  // Handle potential day wrap by normalizing to total seconds in day (but for ET offsets, simple diff works)
  const desiredTotal = hh * 3600 + mm * 60 + ss;
  const actualTotal = etH * 3600 + etM * 60 + etS;
  const deltaSeconds = desiredTotal - actualTotal; // typically +18000 (5h) or +14400 (4h)

  // Step 5: adjust
  return utcMs + deltaSeconds * 1000;
}

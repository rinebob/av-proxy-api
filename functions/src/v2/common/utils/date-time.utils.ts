const ET_TIME_ZONE = 'America/New_York';

function getDatePart(parts: Intl.DateTimeFormatPart[], type: 'year' | 'month' | 'day'): string {
  return parts.find((p) => p.type === type)?.value ?? '';
}

/** Returns yesterday's date in US/Eastern as 'YYYY-MM-DD'. */
export function getYesterdayEt(): string {
  const now = new Date();
  const etParts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const year = Number(getDatePart(etParts, 'year'));
  const month = Number(getDatePart(etParts, 'month'));
  const day = Number(getDatePart(etParts, 'day'));

  const yesterday = new Date(Date.UTC(year, month - 1, day - 1, 12, 0, 0));
  const yParts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(yesterday);

  return `${getDatePart(yParts, 'year')}-${getDatePart(yParts, 'month')}-${getDatePart(yParts, 'day')}`;
}

/**
 * Validates that a string is an ISO calendar date in the form YYYY-MM-DD.
 * The date must exist on the proleptic Gregorian calendar.
 */
export function isValidIsoDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

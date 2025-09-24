import { Pipe, PipeTransform } from '@angular/core';

/**
 * Formats a Date or Firestore Timestamp-like value.
 *
 * Accepted input shapes:
 * - Date
 * - { seconds: number, nanoseconds?: number }
 * - { _seconds: number, _nanoseconds?: number }
 * - number (epoch ms)
 * - string (returned as-is if valid)
 *
 * Formatting modes:
 * - 'iso' (default): ISO 8601 in UTC (e.g., 2025-09-24T20:31:12.000Z)
 * - 'local': human-readable in the user's local timezone using Intl.DateTimeFormat
 * - 'utc': human-readable in UTC using Intl.DateTimeFormat
 * - custom IANA timezone: pass a tz string as the 2nd arg, e.g., 'America/Los_Angeles'
 *   together with format 'local' (for local formatting options) or leave format empty
 *
 * Usage examples (Angular templates):
 *   {{ item.timestamp | tsToIso }}                    // ISO (UTC)
 *   {{ item.timestamp | tsToIso:'local' }}            // Local readable
 *   {{ item.timestamp | tsToIso:'utc' }}              // UTC readable
 *   {{ item.timestamp | tsToIso:'local':'America/New_York' }} // Specific TZ
 *   {{ item.timestamp | tsToIso:'local':undefined:'en-US' }}  // Specific locale
 */
@Pipe({
  name: 'tsToIso',
  standalone: true,
})
export class TsToIsoPipe implements PipeTransform {
  transform(
    value: unknown,
    format: 'iso' | 'local' | 'utc' = 'iso',
    timeZone?: string,
    locale?: string
  ): string {
    const date = this.coerceToDate(value);
    if (!date) return '';

    // ISO (UTC) remains the default for non-breaking behavior
    if (format === 'iso') return date.toISOString();

    // Resolve target timeZone
    const tz = format === 'utc' ? 'UTC' : (timeZone || undefined);

    // Build a concise, readable formatter
    const fmt = new Intl.DateTimeFormat(locale || undefined, {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    return fmt.format(date);
  }

  private coerceToDate(value: unknown): Date | null {
    if (value == null) return null;

    const anyVal: any = value as any;
    if (typeof anyVal === 'object') {
      if (typeof anyVal._seconds === 'number') {
        return new Date(anyVal._seconds * 1000);
      }
      if (typeof anyVal.seconds === 'number') {
        return new Date(anyVal.seconds * 1000);
      }
      if (typeof anyVal.toDate === 'function') {
        try {
          return anyVal.toDate() as Date;
        } catch {}
      }
    }

    if (value instanceof Date) return value;
    if (typeof value === 'number') return new Date(value);
    if (typeof value === 'string') {
      const d = new Date(value);
      return isNaN(d.getTime()) ? null : d;
    }

    const d = new Date(String(value));
    return isNaN(d.getTime()) ? null : d;
  }
}

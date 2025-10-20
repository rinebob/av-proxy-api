import { Pipe, PipeTransform } from '@angular/core';

/**
 * Returns the day of week for a given timestamp-like input, formatted in PT.
 *
 * Accepted input shapes:
 * - Date
 * - { seconds: number, nanoseconds?: number }
 * - { _seconds: number, _nanoseconds?: number }
 * - number (epoch ms)
 * - string (parseable by Date)
 */
@Pipe({
  name: 'dayOfWeek',
  standalone: true,
})
export class DayOfWeekPipe implements PipeTransform {
  transform(value: unknown): string {
    const date = this.coerceToDate(value);
    if (!date) return '';

    // Force Pacific Time per project preference for Health View timestamps
    const fmt = new Intl.DateTimeFormat(undefined, {
      timeZone: 'America/Los_Angeles',
      weekday: 'short',
    });
    return fmt.format(date); // e.g., "Mon", "Tue"
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
        try { return anyVal.toDate() as Date; } catch {}
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

import { Pipe, PipeTransform } from '@angular/core';
import { getTimeMs } from '../utils/health-transforms';

@Pipe({
  name: 'timeAgo',
  standalone: true,
  pure: true,
})
export class TimeAgoPipe implements PipeTransform {
  transform(input: unknown): string {
    let t = 0;

    // Fast path using shared util
    t = getTimeMs(input as unknown);

    // If still 0, try common serialized Firestore shapes and number-like strings
    if (!t && input != null) {
      const v: any = input as any;
      // Firestore REST/serialized Timestamp shapes
      if (typeof v === 'object') {
        if (typeof v.seconds === 'number') t = Math.floor(v.seconds * 1000);
        else if (typeof v._seconds === 'number') t = Math.floor(v._seconds * 1000);
        else if (typeof v.nanoseconds === 'number' && typeof v.seconds === 'number') t = Math.floor(v.seconds * 1000);
        else if (typeof v._nanoseconds === 'number' && typeof v._seconds === 'number') t = Math.floor(v._seconds * 1000);
      }
      // Numeric string (epoch seconds or ms)
      if (!t && (typeof v === 'string' || typeof v === 'number')) {
        const num = Number(v);
        if (!Number.isNaN(num) && Number.isFinite(num)) {
          // Heuristic: 10-digit -> seconds, 13-digit -> ms
          if (String(Math.abs(Math.trunc(num))).length <= 10) t = Math.trunc(num) * 1000;
          else t = Math.trunc(num);
        }
      }
    }

    if (!t) return '-';

    const now = Date.now();
    const diff = Math.max(0, now - t);
    const totalMinutes = Math.floor(diff / 60000);
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;

    const parts: string[] = [];
    if (days) parts.push(`${days}d`);
    if (hours || days) parts.push(`${hours}h`);
    parts.push(`${minutes}m`);

    return parts.join(' ') + ' ago';
  }
}

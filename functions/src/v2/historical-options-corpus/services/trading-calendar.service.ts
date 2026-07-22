/**
 * US equity trading calendar used to plan the QQQ/TQQQ historical options corpus.
 *
 * The calendar is rule-based and covers 2019-2026. It treats the major NYSE
 * closure rules (New Year's, MLK, Presidents, Good Friday, Memorial,
 * Juneteenth, Independence, Labor, Thanksgiving, Christmas) as closed days.
 */

const MS_PER_HOUR = 60 * 60 * 1000;

interface DateParts {
  year: number;
  month: number;
  day: number;
}

function toDateParts(iso: string): DateParts {
  const [year, month, day] = iso.split('-').map(Number);
  return { year, month, day };
}

function toIsoDate({ year, month, day }: DateParts): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addDays(parts: DateParts, days: number): DateParts {
  const target = new Date(Date.UTC(parts.year, parts.month - 1, parts.day) + days * 24 * 60 * 60 * 1000);
  return {
    year: target.getUTCFullYear(),
    month: target.getUTCMonth() + 1,
    day: target.getUTCDate(),
  };
}

/**
 * Returns the day of week for an America/New_York calendar date.
 *
 * Adding 12 hours to a UTC midnight timestamp lands inside the same ET calendar
 * day (ET days start at 04:00 or 05:00 UTC), so getUTCDay() gives the ET
 * day-of-week without a timezone library.
 */
function etDayOfWeek({ year, month, day }: DateParts): number {
  return new Date(Date.UTC(year, month - 1, day) + 12 * MS_PER_HOUR).getUTCDay();
}

function isEtWeekend(parts: DateParts): boolean {
  const dow = etDayOfWeek(parts);
  return dow === 0 || dow === 6;
}

/** Computes the observed weekday for a fixed-date holiday. */
function observedWeekday(parts: DateParts): string {
  const dow = etDayOfWeek(parts);
  if (dow === 6) return toIsoDate(addDays(parts, -1)); // Saturday -> Friday
  if (dow === 0) return toIsoDate(addDays(parts, 1)); // Sunday -> Monday
  return toIsoDate(parts);
}

/** Gregorian Computus algorithm for Easter Sunday. */
function getEasterSunday(year: number): DateParts {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { year, month, day };
}

function getNthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): DateParts {
  const firstDow = etDayOfWeek({ year, month, day: 1 });
  const daysUntilFirst = (weekday - firstDow + 7) % 7;
  const day = 1 + daysUntilFirst + (n - 1) * 7;
  return { year, month, day };
}

function getLastWeekdayOfMonth(year: number, month: number, weekday: number): DateParts {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastDow = etDayOfWeek({ year, month, day: lastDay });
  const diff = (lastDow - weekday + 7) % 7;
  return { year, month, day: lastDay - diff };
}

function getHolidayDatesForYear(year: number): string[] {
  const holidays: string[] = [];

  // New Year's Day
  holidays.push(observedWeekday({ year, month: 1, day: 1 }));

  // Martin Luther King Jr. Day - 3rd Monday in January
  holidays.push(toIsoDate(getNthWeekdayOfMonth(year, 1, 1, 3)));

  // Presidents Day - 3rd Monday in February
  holidays.push(toIsoDate(getNthWeekdayOfMonth(year, 2, 1, 3)));

  // Good Friday - Friday before Easter Sunday
  holidays.push(toIsoDate(addDays(getEasterSunday(year), -2)));

  // Memorial Day - last Monday in May
  holidays.push(toIsoDate(getLastWeekdayOfMonth(year, 5, 1)));

  // Juneteenth National Independence Day - June 19
  holidays.push(observedWeekday({ year, month: 6, day: 19 }));

  // Independence Day - July 4
  holidays.push(observedWeekday({ year, month: 7, day: 4 }));

  // Labor Day - first Monday in September
  holidays.push(toIsoDate(getNthWeekdayOfMonth(year, 9, 1, 1)));

  // Thanksgiving Day - fourth Thursday in November
  holidays.push(toIsoDate(getNthWeekdayOfMonth(year, 11, 4, 4)));

  // Christmas Day - December 25
  holidays.push(observedWeekday({ year, month: 12, day: 25 }));

  return holidays;
}

/** Builds the closed-day set for a range of years, padding by one year on each side. */
function buildHolidaySet(startYear: number, endYear: number): Set<string> {
  const set = new Set<string>();
  for (let year = startYear - 1; year <= endYear + 1; year++) {
    for (const holiday of getHolidayDatesForYear(year)) {
      set.add(holiday);
    }
  }
  return set;
}

export class TradingCalendarService {
  private readonly holidaySet: Set<string>;

  constructor() {
    this.holidaySet = buildHolidaySet(2019, 2026);
  }

  /**
   * Returns true when the provided ISO date is a US equity trading day.
   * Weekend and NYSE-observed holidays return false.
   */
  isTradingDay(isoDate: string): boolean {
    const parts = toDateParts(isoDate);
    if (isEtWeekend(parts)) return false;
    return !this.holidaySet.has(isoDate);
  }

  /**
   * Enumerates US equity trading days between start and end (inclusive).
   * Results are returned ascending by default; pass `descending: true` to
   * return most-recent first.
   */
  getTradingDates(
    startDate: string,
    endDate: string,
    options?: { descending?: boolean },
  ): string[] {
    const dates: string[] = [];
    let current = startDate;

    while (current <= endDate) {
      if (this.isTradingDay(current)) {
        dates.push(current);
      }
      current = toIsoDate(addDays(toDateParts(current), 1));
    }

    if (options?.descending) {
      dates.reverse();
    }

    return dates;
  }
}

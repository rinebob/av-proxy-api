export type MarketHolidayStatus = 'closed' | 'early_close';

export interface MarketHolidayItem {
  name: string;
  date: string; // YYYY-MM-DD (observed date)
  status: MarketHolidayStatus;
  /** Optional ET early close time, e.g. "13:00". Only for status === 'early_close'. */
  earlyCloseEt?: string;
  /** Optional human-readable note, e.g. "observed" semantics. */
  notes?: string;
}

export interface MarketHolidaysForYear {
  holidays: MarketHolidayItem[];
}

export interface UnifiedMarketHolidaysByYear {
  [year: string]: MarketHolidaysForYear;
}

/**
 * Canonical US equities market holiday calendar (unified for NYSE/Nasdaq).
 *
 * Source: static lists provided for 2025–2026. This module is the SOT for
 * partner-facing holiday data; partner apps may mirror this into their own DBs.
 */
export const UNIFIED_MARKET_HOLIDAYS: UnifiedMarketHolidaysByYear = {
  '2025': {
    holidays: [
      { name: "New Year's Day", date: '2025-01-01', status: 'closed' },
      { name: 'Martin Luther King, Jr. Day', date: '2025-01-20', status: 'closed' },
      { name: "Presidents Day", date: '2025-02-17', status: 'closed' },
      { name: 'Good Friday', date: '2025-04-18', status: 'closed' },
      { name: 'Memorial Day', date: '2025-05-26', status: 'closed' },
      { name: 'Juneteenth National Independence Day', date: '2025-06-19', status: 'closed' },
      { name: 'Independence Day', date: '2025-07-04', status: 'closed' },
      { name: 'Labor Day', date: '2025-09-01', status: 'closed' },
      { name: 'Thanksgiving Day', date: '2025-11-27', status: 'closed' },
      { name: 'Christmas Day', date: '2025-12-25', status: 'closed' },
    ],
  },
  '2026': {
    holidays: [
      { name: "New Year's Day", date: '2026-01-01', status: 'closed' },
      { name: 'Martin Luther King, Jr. Day', date: '2026-01-19', status: 'closed' },
      { name: 'Presidents Day', date: '2026-02-16', status: 'closed' },
      { name: 'Good Friday', date: '2026-04-03', status: 'closed' },
      { name: 'Memorial Day', date: '2026-05-25', status: 'closed' },
      { name: 'Juneteenth', date: '2026-06-19', status: 'closed' },
      {
        name: 'Independence Day (Observed)',
        date: '2026-07-03',
        status: 'closed',
        notes: 'Independence Day observed',
      },
      { name: 'Labor Day', date: '2026-09-07', status: 'closed' },
      { name: 'Thanksgiving Day', date: '2026-11-26', status: 'closed' },
      {
        name: 'Day After Thanksgiving (Early Close)',
        date: '2026-11-27',
        status: 'early_close',
        earlyCloseEt: '13:00',
      },
      {
        name: 'Christmas Eve (Early Close)',
        date: '2026-12-24',
        status: 'early_close',
        earlyCloseEt: '13:00',
      },
      { name: 'Christmas Day', date: '2026-12-25', status: 'closed' },
    ],
  },
};

export function getUnifiedMarketHolidaysForYear(year: string): MarketHolidayItem[] {
  return UNIFIED_MARKET_HOLIDAYS[year]?.holidays ?? [];
}

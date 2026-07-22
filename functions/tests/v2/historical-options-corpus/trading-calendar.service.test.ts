import { TradingCalendarService } from '../../../src/v2/historical-options-corpus/services/trading-calendar.service';

describe('TradingCalendarService', () => {
  const calendar = new TradingCalendarService();

  it('treats a weekday without a holiday as a trading day', () => {
    expect(calendar.isTradingDay('2026-01-05')).toBe(true); // Monday
  });

  it('treats Saturday as non-trading', () => {
    expect(calendar.isTradingDay('2026-01-03')).toBe(false);
  });

  it('treats Sunday as non-trading', () => {
    expect(calendar.isTradingDay('2026-01-04')).toBe(false);
  });

  it('recognizes New Years Day 2026 (observed Friday)', () => {
    // Jan 1 2026 is Thursday, observed Thursday.
    expect(calendar.isTradingDay('2026-01-01')).toBe(false);
  });

  it('recognizes MLK Day 2026 (third Monday)', () => {
    expect(calendar.isTradingDay('2026-01-19')).toBe(false);
  });

  it('recognizes Good Friday 2026', () => {
    // Easter 2026 is April 5, Good Friday is April 3.
    expect(calendar.isTradingDay('2026-04-03')).toBe(false);
  });

  it('recognizes New Years Day after the initial corpus range', () => {
    expect(calendar.isTradingDay('2027-01-01')).toBe(false);
  });

  it('enumerates trading dates in ascending order', () => {
    const dates = calendar.getTradingDates('2026-01-01', '2026-01-08');
    expect(dates).toEqual(['2026-01-02', '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08']);
  });

  it('enumerates trading dates in descending order', () => {
    const dates = calendar.getTradingDates('2026-01-08', '2026-01-12', { descending: true });
    expect(dates).toEqual(['2026-01-12', '2026-01-09', '2026-01-08']);
  });

  it('handles DST end (fall back) without duplicating or skipping trading days', () => {
    // DST ends Nov 2 2025; Nov 1 is Saturday.
    const dates = calendar.getTradingDates('2025-11-01', '2025-11-07');
    expect(dates).toEqual(['2025-11-03', '2025-11-04', '2025-11-05', '2025-11-06', '2025-11-07']);
  });

  it('handles DST start (spring forward) without duplicating or skipping trading days', () => {
    // DST starts Mar 8 2026; Mar 7 Saturday, Mar 8 Sunday.
    const dates = calendar.getTradingDates('2026-03-05', '2026-03-12');
    expect(dates).toEqual(['2026-03-05', '2026-03-06', '2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12']);
  });

  it('handles year boundary including New Years Day', () => {
    // Jan 1 2026 is Thursday, observed Thursday (closed). Jan 2 Friday open.
    const dates = calendar.getTradingDates('2025-12-30', '2026-01-04');
    expect(dates).toEqual(['2025-12-30', '2025-12-31', '2026-01-02']);
  });
});

import { MarketCalendarService } from '../../../../src/v2/common/market-calendar/market-calendar.service';

describe('MarketCalendarService', () => {
  const calendar = new MarketCalendarService();

  describe('isTradingDay', () => {
    it('returns false for Saturday', () => {
      expect(calendar.isTradingDay('2026-01-03')).toBe(false); // Saturday
    });

    it('returns false for Sunday', () => {
      expect(calendar.isTradingDay('2026-01-04')).toBe(false); // Sunday
    });

    it('returns false for Labor Day 2026-09-07', () => {
      expect(calendar.isTradingDay('2026-09-07')).toBe(false);
    });

    it('returns false for Christmas Day 2026-12-25', () => {
      expect(calendar.isTradingDay('2026-12-25')).toBe(false);
    });

    it('returns false for Independence Day observed 2026-07-03', () => {
      expect(calendar.isTradingDay('2026-07-03')).toBe(false);
    });

    it('returns true for a normal weekday (Monday)', () => {
      expect(calendar.isTradingDay('2026-01-05')).toBe(true);
    });

    it('returns true for a normal weekday (Wednesday)', () => {
      expect(calendar.isTradingDay('2026-09-09')).toBe(true);
    });
  });

  describe('isMarketOpenAt', () => {
    it('returns false for a holiday regardless of clockPt', () => {
      expect(calendar.isMarketOpenAt('2026-09-07', '0800')).toBe(false); // Labor Day
    });

    it('returns false for a weekend regardless of clockPt', () => {
      expect(calendar.isMarketOpenAt('2026-01-03', '0800')).toBe(false); // Saturday
    });

    it('returns true for a normal trading day at 0800 PT', () => {
      expect(calendar.isMarketOpenAt('2026-09-09', '0800')).toBe(true);
    });

    it('returns true for a normal trading day at 1000 PT', () => {
      expect(calendar.isMarketOpenAt('2026-09-09', '1000')).toBe(true);
    });

    it('returns true for a normal trading day at 1200 PT', () => {
      expect(calendar.isMarketOpenAt('2026-09-09', '1200')).toBe(true);
    });

    it('returns true for an early-close day at 0800 PT (11:00 ET, before 13:00 ET close)', () => {
      expect(calendar.isMarketOpenAt('2026-11-27', '0800')).toBe(true);
    });

    it('returns true for an early-close day at 1000 PT (13:00 ET, at the close boundary)', () => {
      expect(calendar.isMarketOpenAt('2026-11-27', '1000')).toBe(true);
    });

    it('returns false for an early-close day at 1200 PT (15:00 ET, after 13:00 ET close)', () => {
      expect(calendar.isMarketOpenAt('2026-11-27', '1200')).toBe(false);
    });

    it('returns true for Christmas Eve early-close day at 0800 PT', () => {
      expect(calendar.isMarketOpenAt('2026-12-24', '0800')).toBe(true);
    });

    it('returns false for Christmas Eve early-close day at 1200 PT', () => {
      expect(calendar.isMarketOpenAt('2026-12-24', '1200')).toBe(false);
    });
  });

  describe('getEarlyCloseEt', () => {
    it('returns "13:00" for 2026-11-27 (day after Thanksgiving)', () => {
      expect(calendar.getEarlyCloseEt('2026-11-27')).toBe('13:00');
    });

    it('returns "13:00" for 2026-12-24 (Christmas Eve)', () => {
      expect(calendar.getEarlyCloseEt('2026-12-24')).toBe('13:00');
    });

    it('returns null for a normal trading day', () => {
      expect(calendar.getEarlyCloseEt('2026-09-09')).toBeNull();
    });

    it('returns null for a holiday (closed all day)', () => {
      expect(calendar.getEarlyCloseEt('2026-09-07')).toBeNull(); // Labor Day
    });
  });

  describe('year-coverage guard', () => {
    it('throws when the requested year is not in the static data', () => {
      expect(() => calendar.isTradingDay('2027-01-04')).toThrow();
    });

    it('throws when the requested year is not in the static data (isMarketOpenAt)', () => {
      expect(() => calendar.isMarketOpenAt('2027-01-04', '0800')).toThrow();
    });

    it('throws when the requested year is not in the static data (getEarlyCloseEt)', () => {
      expect(() => calendar.getEarlyCloseEt('2027-01-04')).toThrow();
    });

    it('includes the missing year in the error message', () => {
      try {
        calendar.isTradingDay('2027-01-04');
        fail('Should have thrown');
      } catch (e) {
        expect((e as Error).message).toContain('2027');
      }
    });
  });
});

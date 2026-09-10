import { getIntradaySkipReason } from '../../../../src/v2/alpha-vantage/data-refresher/intraday-calendar-gate';

describe('getIntradaySkipReason', () => {
  it('returns null for a normal trading day at 0800 PT', () => {
    expect(getIntradaySkipReason('2026-09-09', '0800')).toBeNull();
  });

  it('returns null for a normal trading day at 1000 PT', () => {
    expect(getIntradaySkipReason('2026-09-09', '1000')).toBeNull();
  });

  it('returns null for a normal trading day at 1200 PT', () => {
    expect(getIntradaySkipReason('2026-09-09', '1200')).toBeNull();
  });

  it('returns "weekend" for Saturday', () => {
    expect(getIntradaySkipReason('2026-01-03', '0800')).toBe('weekend');
  });

  it('returns "weekend" for Sunday', () => {
    expect(getIntradaySkipReason('2026-01-04', '0800')).toBe('weekend');
  });

  it('returns "holiday" for Labor Day 2026-09-07', () => {
    expect(getIntradaySkipReason('2026-09-07', '0800')).toBe('holiday');
  });

  it('returns "holiday" for Christmas Day 2026-12-25', () => {
    expect(getIntradaySkipReason('2026-12-25', '0800')).toBe('holiday');
  });

  it('returns "holiday" for Independence Day observed 2026-07-03', () => {
    expect(getIntradaySkipReason('2026-07-03', '0800')).toBe('holiday');
  });

  it('returns "post_early_close" for early-close day at 1200 PT', () => {
    expect(getIntradaySkipReason('2026-11-27', '1200')).toBe('post_early_close');
  });

  it('returns null for early-close day at 0800 PT (before close)', () => {
    expect(getIntradaySkipReason('2026-11-27', '0800')).toBeNull();
  });

  it('returns null for early-close day at 1000 PT (at close boundary)', () => {
    expect(getIntradaySkipReason('2026-11-27', '1000')).toBeNull();
  });

  it('returns "post_early_close" for Christmas Eve at 1200 PT', () => {
    expect(getIntradaySkipReason('2026-12-24', '1200')).toBe('post_early_close');
  });
});

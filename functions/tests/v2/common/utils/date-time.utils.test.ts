import { isValidIsoDate } from '../../../../src/v2/common/utils/date-time.utils';

describe('isValidIsoDate', () => {
  it('returns true for a valid ISO date', () => {
    expect(isValidIsoDate('2024-07-19')).toBe(true);
  });

  it('returns true for a leap day', () => {
    expect(isValidIsoDate('2024-02-29')).toBe(true);
  });

  it('returns false for a non-existent date', () => {
    expect(isValidIsoDate('2024-02-31')).toBe(false);
  });

  it('returns false for an invalid format', () => {
    expect(isValidIsoDate('07/19/2024')).toBe(false);
  });

  it('returns false for non-date strings', () => {
    expect(isValidIsoDate('not-a-date')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isValidIsoDate('')).toBe(false);
  });
});

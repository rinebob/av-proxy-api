// Unit tests for the POST calendar gate (Task #209).
// Pure function — no Firestore mocks needed.

import { getPostSkipReason } from '../../../../src/v2/alpha-vantage/data-refresher/post-calendar-gate';

describe('POST calendar gate', () => {
  it('returns null on a normal trading day', () => {
    expect(getPostSkipReason('2026-09-11')).toBeNull(); // Friday
  });

  it('returns weekend on Saturday and Sunday', () => {
    expect(getPostSkipReason('2026-09-12')).toBe('weekend'); // Saturday
    expect(getPostSkipReason('2026-09-13')).toBe('weekend'); // Sunday
  });

  it('returns holiday on a weekday market closure', () => {
    expect(getPostSkipReason('2026-11-26')).toBe('holiday'); // Thanksgiving Thursday
    expect(getPostSkipReason('2026-12-25')).toBe('holiday'); // Christmas Friday
  });

  it('returns null on early-close days — post runs still expected', () => {
    expect(getPostSkipReason('2026-11-27')).toBeNull(); // day after Thanksgiving, early close
  });
});

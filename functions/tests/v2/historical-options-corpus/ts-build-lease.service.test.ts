/**
 * Regression tests for the ts-build lease coverage check (Topic #213).
 *
 * Production bug (verified 2026-10-24): `corpus-seed.task.ts` skipped the
 * ts-build enqueue whenever the symbol's lease was held, assuming the
 * in-flight range build covered the new date. A range build ending
 * 2026-09-26 silently dropped every post-9/26 date for QQQ — chains kept
 * landing nightly while series froze at 2026-09-25.
 */
import { leaseCoversDate } from '../../../src/v2/historical-options-corpus/services/ts-build-lease.service';

const NOW = Date.parse('2026-10-24T12:00:00Z');

const held = (over: Record<string, unknown> = {}) => ({
  symbol: 'QQQ',
  lockedUntil: NOW + 60_000,
  ...over,
});

describe('leaseCoversDate', () => {
  it('returns true when the held lease covers the date (the legit skip case)', () => {
    expect(leaseCoversDate(held({ coveredUntil: '2026-09-26' }), '2026-09-20', NOW)).toBe(true);
  });

  it('returns false when the held lease ends BEFORE the date — the QQQ starvation case', () => {
    // Range build ends 2026-09-26; a 2026-10-23 seed must NOT be skipped.
    expect(leaseCoversDate(held({ coveredUntil: '2026-09-26' }), '2026-10-23', NOW)).toBe(false);
  });

  it('returns false when the lease is expired even if coveredUntil is later', () => {
    expect(leaseCoversDate({ lockedUntil: NOW - 1, coveredUntil: '2026-12-31' }, '2026-10-23', NOW)).toBe(false);
  });

  it('returns false for a legacy lease doc with no coveredUntil — conservative, never assume coverage', () => {
    expect(leaseCoversDate(held(), '2026-10-23', NOW)).toBe(false);
  });

  it('returns false for a malformed coveredUntil', () => {
    expect(leaseCoversDate(held({ coveredUntil: 'not-a-date' }), '2026-10-23', NOW)).toBe(false);
  });
});

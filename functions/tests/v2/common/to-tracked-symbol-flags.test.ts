/**
 * Task #142 regression: toTrackedSymbolV2 must carry the optionable /
 * optionsEnabled flag fields through to endpoint responses — otherwise
 * flag-filtered lists return rows without the fields they filtered by.
 * optionable stays absent (un-probed tri-state); optionsEnabled defaults
 * to false per #139 ingestion defaults.
 */
import { Timestamp } from 'firebase-admin/firestore';
import { serializeTrackedSymbols, toTrackedSymbolV2 } from '../../../src/v2/common/common-dm';

const base = { symbol: 'X', _isActive: true };

describe('toTrackedSymbolV2 flag fields', () => {
  it('carries all optionable/optionsEnabled fields when present', () => {
    const doc = {
      ...base,
      optionable: true,
      optionsEnabled: true,
      optionableCheckedAt: 'ts',
      optionableProbeSummary: { totalContracts: 5 },
      optionableProbeError: 'e',
      optionsEnabledHistory: [{ enabled: true }],
    };
    const out = toTrackedSymbolV2(doc);
    expect(out.optionable).toBe(true);
    expect(out.optionsEnabled).toBe(true);
    expect(out.optionableCheckedAt).toBe('ts');
    expect(out.optionableProbeSummary).toEqual({ totalContracts: 5 });
    expect(out.optionableProbeError).toBe('e');
    expect(out.optionsEnabledHistory).toEqual([{ enabled: true }]);
  });

  it('optionsEnabled defaults to false; optionable stays absent on un-probed docs', () => {
    const out = toTrackedSymbolV2({ ...base });
    expect(out.optionsEnabled).toBe(false);
    expect(out.optionable).toBeUndefined();
    expect('optionableCheckedAt' in out).toBe(false);
    expect('optionsEnabledHistory' in out).toBe(false);
  });

  it('preserves optionable=false as a probed-negative (not dropped)', () => {
    const out = toTrackedSymbolV2({ ...base, optionable: false });
    expect(out.optionable).toBe(false);
  });
});

describe('serializeTrackedSymbols nested timestamps', () => {
  it('converts optionableCheckedAt and history.changedAt to ISO strings', () => {
    const ts = Timestamp.fromMillis(1700000000000);
    const [out] = serializeTrackedSymbols([{
      ...base,
      optionableCheckedAt: ts,
      optionsEnabledHistory: [{ enabled: true, changedBy: 'u', changedAt: ts }],
    }]);
    expect(out.optionableCheckedAt).toBe('2023-11-14T22:13:20.000Z');
    expect(out.optionsEnabledHistory[0].changedAt).toBe('2023-11-14T22:13:20.000Z');
    expect(out.optionsEnabledHistory[0].enabled).toBe(true);
    expect(out.optionsEnabledHistory[0].changedBy).toBe('u');
  });

  it('leaves non-Timestamp values untouched', () => {
    const [out] = serializeTrackedSymbols([{ ...base, optionableCheckedAt: 'already-iso' }]);
    expect(out.optionableCheckedAt).toBe('already-iso');
  });
});

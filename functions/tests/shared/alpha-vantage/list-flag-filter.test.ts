/**
 * Unit tests for the listSymbolsV2 flag-filter parser (Task #142).
 *
 * ?optionable= / ?optionsEnabled= are opt-in equality filters: 'true'/'false'
 * bind to a boolean where(); anything else (absent, typo, array) is ignored so
 * an unfiltered list behaves exactly as before.
 */
import { parseSymbolFlagFilterParam } from '@shared/alpha-vantage';

describe('parseSymbolFlagFilterParam', () => {
  it('returns true for "true"', () => {
    expect(parseSymbolFlagFilterParam('true')).toBe(true);
  });

  it('returns false for "false"', () => {
    expect(parseSymbolFlagFilterParam('false')).toBe(false);
  });

  it.each([undefined, null, '', 'yes', '1', 'TRUE', ' tRue ', 'bogus'])(
    'ignores non-boolean value %p',
    (bad) => {
      expect(parseSymbolFlagFilterParam(bad)).toBeUndefined();
    },
  );

  it.each([[['true', 'false']], [[true]], [[false]]])(
    'ignores array query params %p',
    (bad) => {
      expect(parseSymbolFlagFilterParam(bad)).toBeUndefined();
    },
  );
});

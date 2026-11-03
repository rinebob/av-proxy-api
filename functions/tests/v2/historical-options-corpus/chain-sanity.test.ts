// Unit tests for chainSanityCounts (Task #227 — chain sanity flags).
// The derivation is a pure fold over the AV response rows: contract type
// counts feed the put/call-presence flag that marks suspect stored objects.

import {
  chainSanityCounts,
} from '../../../src/v2/historical-options-corpus/services/chain-sanity';
import { AvOptionType, type AvHistoricalOptionsResponse } from '@shared/alpha-vantage';

const response = (types: Array<AvOptionType | undefined>): AvHistoricalOptionsResponse => ({
  endpoint: 'HISTORICAL_OPTIONS',
  message: 'success',
  data: types.map((type) => ({ type })),
});

describe('chainSanityCounts', () => {
  it('counts puts and calls independently of total rows', () => {
    const result = chainSanityCounts(
      response([AvOptionType.CALL, AvOptionType.PUT, AvOptionType.CALL, undefined]),
    );

    expect(result).toEqual({
      putCount: 1,
      callCount: 2,
      rowCount: 4,
      flag: undefined,
    });
  });

  it('flags a zero-row chain as empty', () => {
    expect(chainSanityCounts(response([])).flag).toBe('empty');
    expect(chainSanityCounts(response([])).rowCount).toBe(0);
  });

  it('flags calls-only chains — the observed QQQ malformation', () => {
    const result = chainSanityCounts(
      response([AvOptionType.CALL, AvOptionType.CALL, AvOptionType.CALL]),
    );

    expect(result).toEqual({ putCount: 0, callCount: 3, rowCount: 3, flag: 'calls_only' });
  });

  it('flags puts-only chains', () => {
    const result = chainSanityCounts(response([AvOptionType.PUT]));

    expect(result.flag).toBe('puts_only');
  });

  it('flags rows-only chains with no typed contracts as empty', () => {
    // Untyped rows (AV schema drift) count toward rowCount but never toward a
    // side — zero usable contracts is 'empty' regardless of the row count.
    const result = chainSanityCounts(response([undefined, undefined]));

    expect(result).toEqual({ putCount: 0, callCount: 0, rowCount: 2, flag: 'empty' });
  });
});

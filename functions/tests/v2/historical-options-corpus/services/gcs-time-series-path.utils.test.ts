import { getTimeSeriesObjectPath } from '../../../../src/v2/historical-options-corpus/services/gcs-time-series-path.utils';

describe('getTimeSeriesObjectPath', () => {
  it('builds the default path', () => {
    expect(getTimeSeriesObjectPath('QQQ', 'QQQ240719C00450000')).toBe(
      'time-series/v1/QQQ/QQQ240719C00450000.jsonl',
    );
  });

  it('uppercases symbol and contractID', () => {
    expect(getTimeSeriesObjectPath('qqq', 'qqq240719c00450000')).toBe(
      'time-series/v1/QQQ/QQQ240719C00450000.jsonl',
    );
  });

  it('accepts a custom prefix', () => {
    expect(getTimeSeriesObjectPath('TQQQ', 'TQQQ240719C00450000', 'custom/prefix')).toBe(
      'custom/prefix/TQQQ/TQQQ240719C00450000.jsonl',
    );
  });
});

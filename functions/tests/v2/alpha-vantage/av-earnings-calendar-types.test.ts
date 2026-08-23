import {
  AvEarningsCalendarEntry,
} from '@shared/alpha-vantage/av-earnings-calendar-types';

describe('AvEarningsCalendarEntry type', () => {
  it('accepts all CSV column fields', () => {
    const entry: AvEarningsCalendarEntry = {
      symbol: 'IBM',
      name: 'International Business Machines',
      reportDate: '2025-01-15',
      fiscalDateEnding: '2024-12-31',
      estimate: '1.50',
      currency: 'USD',
      timeOfTheDay: 'post-market',
    };
    expect(entry.symbol).toBe('IBM');
    expect(entry.name).toBe('International Business Machines');
    expect(entry.reportDate).toBe('2025-01-15');
  });

  it('accepts empty string for estimate and timeOfTheDay', () => {
    const entry: AvEarningsCalendarEntry = {
      symbol: 'IBM',
      name: 'International Business Machines',
      reportDate: '2025-01-15',
      fiscalDateEnding: '2024-12-31',
      estimate: '',
      currency: 'USD',
      timeOfTheDay: '',
    };
    expect(entry.estimate).toBe('');
    expect(entry.timeOfTheDay).toBe('');
  });
});

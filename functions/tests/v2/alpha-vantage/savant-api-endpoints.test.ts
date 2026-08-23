import {
  SavantApiEndpoint,
  SA_ENDPOINT_TO_AV_FUNCTION,
} from '@shared/alpha-vantage/savant-api-endpoints';
import { AlphaVantageEndpoint } from '@shared/alpha-vantage/av-endpoints';

describe('SavantApiEndpoint enum', () => {
  it('has all four SA- endpoint values', () => {
    expect(SavantApiEndpoint.SA_EARNINGS).toBe('SA_EARNINGS');
    expect(SavantApiEndpoint.SA_EARNINGS_ESTIMATES).toBe('SA_EARNINGS_ESTIMATES');
    expect(SavantApiEndpoint.SA_EARNINGS_CALENDAR).toBe('SA_EARNINGS_CALENDAR');
    expect(SavantApiEndpoint.SA_EARNINGS_CALENDAR_GLOBAL).toBe('SA_EARNINGS_CALENDAR_GLOBAL');
  });

  it('has exactly 4 enum members', () => {
    const values = Object.values(SavantApiEndpoint);
    expect(values).toHaveLength(4);
  });
});

describe('SA_ENDPOINT_TO_AV_FUNCTION mapping', () => {
  it('maps SA_EARNINGS to AV EARNINGS', () => {
    expect(SA_ENDPOINT_TO_AV_FUNCTION[SavantApiEndpoint.SA_EARNINGS]).toBe(AlphaVantageEndpoint.EARNINGS);
  });

  it('maps SA_EARNINGS_ESTIMATES to AV EARNINGS_ESTIMATES', () => {
    expect(SA_ENDPOINT_TO_AV_FUNCTION[SavantApiEndpoint.SA_EARNINGS_ESTIMATES]).toBe(AlphaVantageEndpoint.EARNINGS_ESTIMATES);
  });

  it('maps SA_EARNINGS_CALENDAR to AV EARNINGS_CALENDAR', () => {
    expect(SA_ENDPOINT_TO_AV_FUNCTION[SavantApiEndpoint.SA_EARNINGS_CALENDAR]).toBe(AlphaVantageEndpoint.EARNINGS_CALENDAR);
  });

  it('maps SA_EARNINGS_CALENDAR_GLOBAL to AV EARNINGS_CALENDAR (same AV function, different SA endpoint)', () => {
    expect(SA_ENDPOINT_TO_AV_FUNCTION[SavantApiEndpoint.SA_EARNINGS_CALENDAR_GLOBAL]).toBe(AlphaVantageEndpoint.EARNINGS_CALENDAR);
  });

  it('has a mapping for every SA endpoint', () => {
    for (const saEndpoint of Object.values(SavantApiEndpoint)) {
      expect(SA_ENDPOINT_TO_AV_FUNCTION[saEndpoint]).toBeDefined();
    }
  });

  it('every mapping value is a valid AlphaVantageEndpoint', () => {
    const avValues = Object.values(AlphaVantageEndpoint);
    for (const avFunction of Object.values(SA_ENDPOINT_TO_AV_FUNCTION)) {
      expect(avValues).toContain(avFunction);
    }
  });
});

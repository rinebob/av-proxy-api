import {
  AvEarningsResponse,
  AvAnnualEarning,
  AvQuarterlyEarning,
} from '@shared/alpha-vantage/av-earnings-types';

describe('AvEarningsResponse types', () => {
  it('AvAnnualEarning accepts fiscalDateEnding and reportedEPS', () => {
    const annual: AvAnnualEarning = {
      fiscalDateEnding: '2024-12-31',
      reportedEPS: '1.50',
    };
    expect(annual.fiscalDateEnding).toBe('2024-12-31');
    expect(annual.reportedEPS).toBe('1.50');
  });

  it('AvQuarterlyEarning accepts all fields including reportTime', () => {
    const quarterly: AvQuarterlyEarning = {
      fiscalDateEnding: '2024-12-31',
      reportedDate: '2025-01-15',
      reportedEPS: '1.50',
      estimatedEPS: '1.45',
      surprise: '0.05',
      surprisePercentage: '3.45',
      reportTime: 'post-market',
    };
    expect(quarterly.reportTime).toBe('post-market');
  });

  it('AvQuarterlyEarning reportTime accepts pre-market', () => {
    const quarterly: AvQuarterlyEarning = {
      fiscalDateEnding: '2024-12-31',
      reportedDate: '2025-01-15',
      reportedEPS: '1.50',
      estimatedEPS: '1.45',
      surprise: '0.05',
      surprisePercentage: '3.45',
      reportTime: 'pre-market',
    };
    expect(quarterly.reportTime).toBe('pre-market');
  });

  it('AvEarningsResponse accepts symbol, annualEarnings, and quarterlyEarnings arrays', () => {
    const response: AvEarningsResponse = {
      symbol: 'IBM',
      annualEarnings: [
        { fiscalDateEnding: '2024-12-31', reportedEPS: '1.50' },
      ],
      quarterlyEarnings: [
        {
          fiscalDateEnding: '2024-12-31',
          reportedDate: '2025-01-15',
          reportedEPS: '1.50',
          estimatedEPS: '1.45',
          surprise: '0.05',
          surprisePercentage: '3.45',
          reportTime: 'post-market',
        },
      ],
    };
    expect(response.symbol).toBe('IBM');
    expect(response.annualEarnings).toHaveLength(1);
    expect(response.quarterlyEarnings).toHaveLength(1);
  });

  it('AvEarningsResponse accepts empty arrays', () => {
    const response: AvEarningsResponse = {
      symbol: 'IBM',
      annualEarnings: [],
      quarterlyEarnings: [],
    };
    expect(response.annualEarnings).toHaveLength(0);
    expect(response.quarterlyEarnings).toHaveLength(0);
  });
});

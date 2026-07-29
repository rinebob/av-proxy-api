import { buildContractID } from '../../../src/v2/spread-pricing/services';

describe('buildContractID', () => {
  it('constructs a valid OCC ID for a QQQ call at strike 450', () => {
    const id = buildContractID('QQQ', '2024-07-19', 'call', 450);
    expect(id).toBe('QQQ240719C00450000');
  });

  it('constructs a valid OCC ID for a TQQQ put at strike 100', () => {
    const id = buildContractID('TQQQ', '2024-07-19', 'put', 100);
    expect(id).toBe('TQQQ240719P00100000');
  });

  it('handles fractional strikes (450.5)', () => {
    const id = buildContractID('QQQ', '2024-07-19', 'call', 450.5);
    expect(id).toBe('QQQ240719C00450500');
  });

  it('handles very small fractional strikes (0.5)', () => {
    const id = buildContractID('QQQ', '2024-07-19', 'put', 0.5);
    expect(id).toBe('QQQ240719P00000500');
  });

  it('handles large strikes (1000)', () => {
    const id = buildContractID('QQQ', '2024-07-19', 'call', 1000);
    expect(id).toBe('QQQ240719C01000000');
  });

  it('uppercases the symbol', () => {
    const id = buildContractID('qqq', '2024-07-19', 'call', 450);
    expect(id).toBe('QQQ240719C00450000');
  });
});

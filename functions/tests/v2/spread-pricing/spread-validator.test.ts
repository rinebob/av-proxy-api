import { validateSpread, classifyDebitOrCredit } from '../../../src/v2/spread-pricing/services';
import type { SpreadRequest } from '../../../src/v2/partner/spread-request.types';

function makeVertical(overrides: Partial<SpreadRequest> = {}): SpreadRequest {
  return {
    spreadType: 'vertical',
    symbol: 'QQQ',
    legs: [
      { expiration: '2024-07-19', strike: 450, optionType: 'call', direction: 'long' },
      { expiration: '2024-07-19', strike: 455, optionType: 'call', direction: 'short' },
    ],
    ...overrides,
  };
}

function makeStraddle(overrides: Partial<SpreadRequest> = {}): SpreadRequest {
  return {
    spreadType: 'straddle',
    symbol: 'QQQ',
    legs: [
      { expiration: '2024-07-19', strike: 450, optionType: 'call', direction: 'long' },
      { expiration: '2024-07-19', strike: 450, optionType: 'put', direction: 'long' },
    ],
    ...overrides,
  };
}

function makeStrangle(overrides: Partial<SpreadRequest> = {}): SpreadRequest {
  return {
    spreadType: 'strangle',
    symbol: 'QQQ',
    legs: [
      { expiration: '2024-07-19', strike: 445, optionType: 'put', direction: 'long' },
      { expiration: '2024-07-19', strike: 455, optionType: 'call', direction: 'long' },
    ],
    ...overrides,
  };
}

function makeIronCondor(overrides: Partial<SpreadRequest> = {}): SpreadRequest {
  return {
    spreadType: 'iron_condor',
    symbol: 'QQQ',
    legs: [
      { expiration: '2024-07-19', strike: 445, optionType: 'put', direction: 'long' },
      { expiration: '2024-07-19', strike: 450, optionType: 'put', direction: 'short' },
      { expiration: '2024-07-19', strike: 455, optionType: 'call', direction: 'short' },
      { expiration: '2024-07-19', strike: 460, optionType: 'call', direction: 'long' },
    ],
    ...overrides,
  };
}

describe('validateSpread', () => {
  describe('vertical', () => {
    it('accepts a valid vertical spread', () => {
      expect(validateSpread(makeVertical())).toEqual({ valid: true });
    });

    it('rejects same strike on vertical', () => {
      const req = makeVertical({
        legs: [
          { expiration: '2024-07-19', strike: 450, optionType: 'call', direction: 'long' },
          { expiration: '2024-07-19', strike: 450, optionType: 'call', direction: 'short' },
        ],
      });
      expect(validateSpread(req).valid).toBe(false);
    });

    it('rejects 3 legs on vertical', () => {
      const req = makeVertical({
        legs: [
          { expiration: '2024-07-19', strike: 450, optionType: 'call', direction: 'long' },
          { expiration: '2024-07-19', strike: 455, optionType: 'call', direction: 'short' },
          { expiration: '2024-07-19', strike: 460, optionType: 'call', direction: 'long' },
        ],
      } as any);
      expect(validateSpread(req).valid).toBe(false);
    });

    it('rejects mismatched optionType on vertical', () => {
      const req = makeVertical({
        legs: [
          { expiration: '2024-07-19', strike: 450, optionType: 'call', direction: 'long' },
          { expiration: '2024-07-19', strike: 455, optionType: 'put', direction: 'short' },
        ],
      });
      expect(validateSpread(req).valid).toBe(false);
    });

    it('rejects same direction on vertical', () => {
      const req = makeVertical({
        legs: [
          { expiration: '2024-07-19', strike: 450, optionType: 'call', direction: 'long' },
          { expiration: '2024-07-19', strike: 455, optionType: 'call', direction: 'long' },
        ],
      });
      expect(validateSpread(req).valid).toBe(false);
    });
  });

  describe('straddle', () => {
    it('accepts a valid straddle', () => {
      expect(validateSpread(makeStraddle())).toEqual({ valid: true });
    });

    it('rejects different strikes on straddle', () => {
      const req = makeStraddle({
        legs: [
          { expiration: '2024-07-19', strike: 450, optionType: 'call', direction: 'long' },
          { expiration: '2024-07-19', strike: 455, optionType: 'put', direction: 'long' },
        ],
      });
      expect(validateSpread(req).valid).toBe(false);
    });

    it('rejects same optionType on straddle', () => {
      const req = makeStraddle({
        legs: [
          { expiration: '2024-07-19', strike: 450, optionType: 'call', direction: 'long' },
          { expiration: '2024-07-19', strike: 450, optionType: 'call', direction: 'long' },
        ],
      });
      expect(validateSpread(req).valid).toBe(false);
    });
  });

  describe('strangle', () => {
    it('accepts a valid strangle', () => {
      expect(validateSpread(makeStrangle())).toEqual({ valid: true });
    });

    it('rejects same strike on strangle', () => {
      const req = makeStrangle({
        legs: [
          { expiration: '2024-07-19', strike: 450, optionType: 'put', direction: 'long' },
          { expiration: '2024-07-19', strike: 450, optionType: 'call', direction: 'long' },
        ],
      });
      expect(validateSpread(req).valid).toBe(false);
    });

    it('rejects mismatched expiration on strangle', () => {
      const req = makeStrangle({
        legs: [
          { expiration: '2024-07-19', strike: 445, optionType: 'put', direction: 'long' },
          { expiration: '2024-08-16', strike: 455, optionType: 'call', direction: 'long' },
        ],
      });
      expect(validateSpread(req).valid).toBe(false);
    });

    it('rejects different directions on strangle', () => {
      const req = makeStrangle({
        legs: [
          { expiration: '2024-07-19', strike: 445, optionType: 'put', direction: 'long' },
          { expiration: '2024-07-19', strike: 455, optionType: 'call', direction: 'short' },
        ],
      });
      expect(validateSpread(req).valid).toBe(false);
    });
  });

  describe('iron_condor', () => {
    it('accepts a valid iron condor', () => {
      expect(validateSpread(makeIronCondor())).toEqual({ valid: true });
    });

    it('rejects 3 legs on iron condor', () => {
      const req = makeIronCondor({
        legs: [
          { expiration: '2024-07-19', strike: 445, optionType: 'put', direction: 'long' },
          { expiration: '2024-07-19', strike: 450, optionType: 'put', direction: 'short' },
          { expiration: '2024-07-19', strike: 455, optionType: 'call', direction: 'short' },
        ],
      } as any);
      expect(validateSpread(req).valid).toBe(false);
    });

    it('rejects mismatched expirations on iron condor', () => {
      const req = makeIronCondor({
        legs: [
          { expiration: '2024-07-19', strike: 445, optionType: 'put', direction: 'long' },
          { expiration: '2024-08-16', strike: 450, optionType: 'put', direction: 'short' },
          { expiration: '2024-07-19', strike: 455, optionType: 'call', direction: 'short' },
          { expiration: '2024-07-19', strike: 460, optionType: 'call', direction: 'long' },
        ],
      });
      expect(validateSpread(req).valid).toBe(false);
    });

    it('rejects duplicate strikes on iron condor', () => {
      const req = makeIronCondor({
        legs: [
          { expiration: '2024-07-19', strike: 450, optionType: 'put', direction: 'long' },
          { expiration: '2024-07-19', strike: 450, optionType: 'put', direction: 'short' },
          { expiration: '2024-07-19', strike: 455, optionType: 'call', direction: 'short' },
          { expiration: '2024-07-19', strike: 460, optionType: 'call', direction: 'long' },
        ],
      });
      expect(validateSpread(req).valid).toBe(false);
    });

    it('rejects wrong call/put ratio (3 calls + 1 put)', () => {
      const req = makeIronCondor({
        legs: [
          { expiration: '2024-07-19', strike: 445, optionType: 'call', direction: 'long' },
          { expiration: '2024-07-19', strike: 450, optionType: 'call', direction: 'short' },
          { expiration: '2024-07-19', strike: 455, optionType: 'call', direction: 'short' },
          { expiration: '2024-07-19', strike: 460, optionType: 'put', direction: 'long' },
        ],
      });
      expect(validateSpread(req).valid).toBe(false);
    });

    it('rejects wrong long/short ratio (3 long + 1 short)', () => {
      const req = makeIronCondor({
        legs: [
          { expiration: '2024-07-19', strike: 445, optionType: 'put', direction: 'long' },
          { expiration: '2024-07-19', strike: 450, optionType: 'put', direction: 'short' },
          { expiration: '2024-07-19', strike: 455, optionType: 'call', direction: 'long' },
          { expiration: '2024-07-19', strike: 460, optionType: 'call', direction: 'long' },
        ],
      });
      expect(validateSpread(req).valid).toBe(false);
    });
  });

  describe('general validation', () => {
    it('rejects unsupported symbol', () => {
      const req = makeVertical({ symbol: 'AAPL' });
      expect(validateSpread(req).valid).toBe(false);
    });

    it('rejects invalid spreadType', () => {
      const req = makeVertical({ spreadType: 'butterfly' as any });
      expect(validateSpread(req).valid).toBe(false);
    });

    it('rejects invalid expiration date', () => {
      const req = makeVertical({
        legs: [
          { expiration: 'invalid', strike: 450, optionType: 'call', direction: 'long' },
          { expiration: '2024-07-19', strike: 455, optionType: 'call', direction: 'short' },
        ],
      });
      expect(validateSpread(req).valid).toBe(false);
    });

    it('rejects negative strike', () => {
      const req = makeVertical({
        legs: [
          { expiration: '2024-07-19', strike: -1, optionType: 'call', direction: 'long' },
          { expiration: '2024-07-19', strike: 455, optionType: 'call', direction: 'short' },
        ],
      });
      expect(validateSpread(req).valid).toBe(false);
    });

    it('rejects startDate > endDate', () => {
      const req = makeVertical({ startDate: '2024-07-20', endDate: '2024-07-19' });
      expect(validateSpread(req).valid).toBe(false);
    });
  });
});

describe('classifyDebitOrCredit', () => {
  it('classifies vertical call debit (long strike < short strike)', () => {
    const req = makeVertical();
    expect(classifyDebitOrCredit(req.spreadType, req.legs)).toBe('debit');
  });

  it('classifies vertical call credit (long strike > short strike)', () => {
    const req = makeVertical({
      legs: [
        { expiration: '2024-07-19', strike: 455, optionType: 'call', direction: 'long' },
        { expiration: '2024-07-19', strike: 450, optionType: 'call', direction: 'short' },
      ],
    });
    expect(classifyDebitOrCredit(req.spreadType, req.legs)).toBe('credit');
  });

  it('classifies vertical put debit (long strike > short strike)', () => {
    const req = makeVertical({
      legs: [
        { expiration: '2024-07-19', strike: 455, optionType: 'put', direction: 'long' },
        { expiration: '2024-07-19', strike: 450, optionType: 'put', direction: 'short' },
      ],
    });
    expect(classifyDebitOrCredit(req.spreadType, req.legs)).toBe('debit');
  });

  it('classifies straddle long as debit', () => {
    const req = makeStraddle();
    expect(classifyDebitOrCredit(req.spreadType, req.legs)).toBe('debit');
  });

  it('classifies straddle short as credit', () => {
    const req = makeStraddle({
      legs: [
        { expiration: '2024-07-19', strike: 450, optionType: 'call', direction: 'short' },
        { expiration: '2024-07-19', strike: 450, optionType: 'put', direction: 'short' },
      ],
    });
    expect(classifyDebitOrCredit(req.spreadType, req.legs)).toBe('credit');
  });

  it('classifies iron condor as credit', () => {
    const req = makeIronCondor();
    expect(classifyDebitOrCredit(req.spreadType, req.legs)).toBe('credit');
  });
});

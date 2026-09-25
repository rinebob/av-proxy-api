/**
 * Unit tests for compareTrackedSymbolsByField (Task #142) — the in-memory
 * comparator used when optionable/optionsEnabled flag filters skip orderBy
 * to avoid composite-index requirements.
 */
import { Timestamp } from 'firebase-admin/firestore';
import { compareTrackedSymbolsByField } from '../../../../src/v2/alpha-vantage/services/symbol-manager.service';

const sym = (symbol: string, extra: Record<string, unknown> = {}) =>
  ({ symbol, ...extra }) as any;

describe('compareTrackedSymbolsByField', () => {
  it('sorts asc and desc on a top-level field', () => {
    const rows = [sym('C'), sym('A'), sym('B')];
    expect([...rows].sort(compareTrackedSymbolsByField('symbol', 'asc')).map((r) => r.symbol)).toEqual(['A', 'B', 'C']);
    expect([...rows].sort(compareTrackedSymbolsByField('symbol', 'desc')).map((r) => r.symbol)).toEqual(['C', 'B', 'A']);
  });

  it('sorts on dotted companyInfo paths', () => {
    const rows = [
      sym('A', { companyInfo: { Sector: 'Tech' } }),
      sym('B', { companyInfo: { Sector: 'Energy' } }),
    ];
    expect([...rows].sort(compareTrackedSymbolsByField('companyInfo.Sector', 'asc')).map((r) => r.symbol)).toEqual(['B', 'A']);
  });

  it('sorts Timestamps numerically', () => {
    const rows = [
      sym('A', { _createdAt: Timestamp.fromMillis(3000) }),
      sym('B', { _createdAt: Timestamp.fromMillis(1000) }),
    ];
    expect([...rows].sort(compareTrackedSymbolsByField('_createdAt', 'asc')).map((r) => r.symbol)).toEqual(['B', 'A']);
  });

  it.each([['asc'], ['desc']] as const)(
    'docs missing the field go last (%s)',
    (dir) => {
      const rows = [
        sym('MISSING'),
        sym('B', { name: 'b' }),
        sym('A', { name: 'a' }),
      ];
      const sorted = [...rows].sort(compareTrackedSymbolsByField('name', dir)).map((r) => r.symbol);
      expect(sorted[sorted.length - 1]).toBe('MISSING');
    },
  );

  it('tie-breaks on symbol so pages are stable', () => {
    const rows = [sym('Z', { name: 'same' }), sym('A', { name: 'same' })];
    expect([...rows].sort(compareTrackedSymbolsByField('name', 'asc')).map((r) => r.symbol)).toEqual(['A', 'Z']);
  });
});

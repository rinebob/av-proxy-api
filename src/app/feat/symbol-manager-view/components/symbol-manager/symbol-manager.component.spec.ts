import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideExperimentalZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { SymbolManagerComponent } from './symbol-manager.component';
import { SymbolManagerStore } from '../../store/symbol-manager.store';
import { SymbolManagerService } from '../../services/symbol-manager.service';
import type { TrackedSymbolV2 } from '@shared/alpha-vantage';

function sym(symbol: string, companyInfo?: Partial<NonNullable<TrackedSymbolV2['companyInfo']>>): TrackedSymbolV2 {
  return { symbol, name: symbol + ' Corp', companyInfo } as TrackedSymbolV2;
}

describe('SymbolManagerComponent — sort + paginate pipeline', () => {
  let component: SymbolManagerComponent;
  let v2Symbols: ReturnType<typeof signal<TrackedSymbolV2[]>>;
  let v2Total: ReturnType<typeof signal<number>>;

  const rows = [
    sym('MID', { marketCap: 5e11, Sector: 'INDUSTRIALS' }),
    sym('ETF'), // no companyInfo — must sort last
    sym('HI', { marketCap: 3e12, Sector: 'TECHNOLOGY' }),
    sym('LO', { marketCap: 1e9, Sector: 'FINANCIALS' }),
  ];

  beforeEach(() => {
    v2Symbols = signal<TrackedSymbolV2[]>(rows);
    v2Total = signal<number>(rows.length);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideExperimentalZonelessChangeDetection(),
        { provide: SymbolManagerService, useValue: {} },
        {
          provide: SymbolManagerStore,
          useValue: {
            v2Symbols,
            v2Total,
            v2SymbolSearchResult: signal(null),
            loading: signal(false),
            error: signal(null),
          },
        },
      ],
    });
    // no fixture.detectChanges() — ngOnInit would fire listSymbolsV2; the
    // pipeline computeds don't need change detection.
    component = TestBed.createComponent(SymbolManagerComponent).componentInstance;
  });

  it('sorts the full loaded set — page 2 continues the ranking', () => {
    component.pageSize.set(2);
    component.onSortClick('marketCap');
    component.onSortClick('marketCap'); // → desc

    expect(component.displayedSymbols().map(s => s.symbol)).toEqual(['HI', 'MID']);
    component.pageIndex.set(1);
    expect(component.displayedSymbols().map(s => s.symbol)).toEqual(['LO', 'ETF']);
  });

  it('multi-level: sector primary, name secondary within each sector', () => {
    v2Symbols.set([
      { ...sym('ZZ1', { Sector: 'TECHNOLOGY' }), name: 'Zeta' },
      { ...sym('ZZ2', { Sector: 'FINANCIALS' }), name: 'Omega' },
      { ...sym('ZZ3', { Sector: 'TECHNOLOGY' }), name: 'Alpha' },
      { ...sym('ZZ4', { Sector: 'FINANCIALS' }), name: 'Beta' },
    ] as TrackedSymbolV2[]);
    component.pageSize.set(10);
    component.onSortClick('sector'); // primary: FINANCIALS < TECHNOLOGY
    component.onSortClick('name');   // secondary: name within sector
    expect(component.displayedSymbols().map(s => s.symbol)).toEqual(['ZZ4', 'ZZ2', 'ZZ3', 'ZZ1']);
    expect(component.sortIndicator('sector')).toBe('▲1');
    expect(component.sortIndicator('name')).toBe('▲2');
  });

  it('clicking a sorted column cycles asc → desc → off', () => {
    component.onSortClick('sector');
    component.onSortClick('sector');
    expect(component.sortIndicator('sector')).toBe('▼');
    component.onSortClick('sector');
    expect(component.sortIndicator('sector')).toBe('');
  });

  it('missing values sort last in both directions', () => {
    component.onSortClick('marketCap');
    expect(component.displayedSymbols().at(-1)!.symbol).toBe('ETF');
    component.onSortClick('marketCap'); // desc
    expect(component.displayedSymbols().at(-1)!.symbol).toBe('ETF');
  });

  it('sorting composes with the filter text', () => {
    component.filterText.set('corp'); // matches all ("X Corp") — filter then sort
    component.onSortClick('sector');
    component.pageSize.set(10);
    expect(component.displayedSymbols().at(-1)!.symbol).toBe('ETF');
  });

  it('empty sort stack falls back to symbol order', () => {
    component.pageSize.set(10);
    expect(component.displayedSymbols().map(s => s.symbol)).toEqual(['ETF', 'HI', 'LO', 'MID']);
  });

  it('fetch-cap guard shows only when loaded < server total', () => {
    expect(component.fetchCapHit()).toBe(false);
    v2Total.set(rows.length + 500);
    expect(component.fetchCapHit()).toBe(true);
  });
});

import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideExperimentalZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatCheckboxChange } from '@angular/material/checkbox';
import { of } from 'rxjs';

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

describe('SymbolManagerComponent � Options Enabled toggle (Task #144)', () => {
  let component: SymbolManagerComponent;
  let dialogOpen: jasmine.Spy;
  let setOptionsEnabled: jasmine.Spy;
  let snackOpen: jasmine.Spy;

  const optionableRow = { symbol: 'AAPL', optionable: true, optionsEnabled: false } as TrackedSymbolV2;
  const nonOptionableRow = { symbol: 'BRK-B', optionable: false, optionsEnabled: false } as TrackedSymbolV2;
  const unprobedRow = { symbol: 'NEWCO', optionsEnabled: false } as TrackedSymbolV2;

  function checkbox(checked: boolean): MatCheckboxChange {
    return { checked, source: { checked: undefined } } as unknown as MatCheckboxChange;
  }

  function setup(dialogResult: unknown) {
    dialogOpen = jasmine.createSpy('open').and.returnValue({ afterClosed: () => of(dialogResult) } as any);
    setOptionsEnabled = jasmine.createSpy('setOptionsEnabled').and.returnValue(of({ ok: true, symbol: 'AAPL', transitioned: true }));
    snackOpen = jasmine.createSpy('open');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideExperimentalZonelessChangeDetection(),
        { provide: SymbolManagerService, useValue: {} },
        { provide: MatSnackBar, useValue: { open: snackOpen } },
        {
          provide: SymbolManagerStore,
          useValue: {
            v2Symbols: signal<TrackedSymbolV2[]>([]),
            v2Total: signal(0),
            v2SymbolSearchResult: signal(null),
            loading: signal(false),
            error: signal(null),
            setOptionsEnabled,
          },
        },
      ],
    });
    component = TestBed.createComponent(SymbolManagerComponent).componentInstance;
    // MatDialog/MatSnackBar come from the standalone component's own imports —
    // provider overrides don't reach them, so swap the injected instances.
    (component as any).dialog = { open: dialogOpen };
    (component as any).snackBar = { open: snackOpen };
  }

  it('non-optionable row: no dialog, no call, checkbox reverts', () => {
    setup(true);
    const ev = checkbox(true);
    component.onOptionsEnabledToggle(nonOptionableRow, ev);
    expect(dialogOpen).not.toHaveBeenCalled();
    expect(setOptionsEnabled).not.toHaveBeenCalled();
    expect(ev.source.checked).toBe(false);
  });

  it('unprobed row (optionable absent): same non-optionable behavior', () => {
    setup(true);
    const ev = checkbox(true);
    component.onOptionsEnabledToggle(unprobedRow, ev);
    expect(dialogOpen).not.toHaveBeenCalled();
    expect(ev.source.checked).toBe(false);
  });

  it('confirm: calls store.setOptionsEnabled with symbol + target state', () => {
    setup(true);
    component.onOptionsEnabledToggle(optionableRow, checkbox(true));
    expect(dialogOpen).toHaveBeenCalled();
    expect(setOptionsEnabled).toHaveBeenCalledWith('AAPL', true);
    expect(snackOpen).toHaveBeenCalled();
  });

  it('idempotent no-op (ok, not transitioned): informational message, checkbox reverts', () => {
    setup(true);
    setOptionsEnabled.and.returnValue(of({ ok: true, symbol: 'AAPL', transitioned: false }));
    const ev = checkbox(true);
    component.onOptionsEnabledToggle(optionableRow, ev);
    expect(ev.source.checked).toBe(false);
    expect(snackOpen).toHaveBeenCalledWith('AAPL was already enabled', 'Close', jasmine.anything());
  });

  it('cancel: no call, checkbox reverts', () => {
    setup(undefined);
    const ev = checkbox(true);
    component.onOptionsEnabledToggle(optionableRow, ev);
    expect(setOptionsEnabled).not.toHaveBeenCalled();
    expect(ev.source.checked).toBe(false);
  });

  it('callable failure: checkbox reverts + error snackbar', () => {
    setup(true);
    setOptionsEnabled.and.returnValue(of({ ok: false, symbol: 'AAPL', transitioned: false, error: 'nope' }));
    const ev = checkbox(true);
    component.onOptionsEnabledToggle(optionableRow, ev);
    expect(ev.source.checked).toBe(false);
    expect(snackOpen).toHaveBeenCalledWith('nope', 'Dismiss', jasmine.anything());
  });

  it('tooltip explains the disabled states', () => {
    setup(undefined);
    expect(component.optionsEnabledTooltip(optionableRow)).toBe('');
    expect(component.optionsEnabledTooltip(nonOptionableRow)).toContain('No listed options');
    expect(component.optionsEnabledTooltip(unprobedRow)).toContain('not probed');
  });
});

import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideExperimentalZonelessChangeDetection } from '@angular/core';

import { DataMaintainerViewComponent } from './data-maintainer-view.component';
import { AlphaVantageStore } from './store/alpha-vantage.store';
import { API_BASES, type ApiBases } from '../../core/api/api.tokens';
import { AlphaVantageEndpoint } from '@shared/alpha-vantage';

describe('DataMaintainerViewComponent — isGlobalEndpoint', () => {
  let component: DataMaintainerViewComponent;

  const mockApiBases: ApiBases = {
    health: 'https://test.cloudfunctions.net',
    av: 'https://test.cloudfunctions.net',
    dm: 'https://test.cloudfunctions.net',
    benzinga: 'https://test.cloudfunctions.net',
    partner: 'https://test.cloudfunctions.net',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideExperimentalZonelessChangeDetection(),
        { provide: API_BASES, useValue: mockApiBases },
        AlphaVantageStore,
      ],
    });
    const fixture = TestBed.createComponent(DataMaintainerViewComponent);
    component = fixture.componentInstance;
  });

  it('returns true for EARNINGS_CALENDAR (global, no {symbol} in path)', () => {
    expect(component.isGlobalEndpoint(AlphaVantageEndpoint.EARNINGS_CALENDAR)).toBe(true);
  });

  it('returns false for EARNINGS (per-symbol, has {symbol} in path)', () => {
    expect(component.isGlobalEndpoint(AlphaVantageEndpoint.EARNINGS)).toBe(false);
  });

  it('returns false for EARNINGS_ESTIMATES (per-symbol, has {symbol} in path)', () => {
    expect(component.isGlobalEndpoint(AlphaVantageEndpoint.EARNINGS_ESTIMATES)).toBe(false);
  });

  it('returns false for OVERVIEW (per-symbol)', () => {
    expect(component.isGlobalEndpoint(AlphaVantageEndpoint.OVERVIEW)).toBe(false);
  });

  it('returns false for null endpoint', () => {
    expect(component.isGlobalEndpoint(null)).toBe(false);
  });
});

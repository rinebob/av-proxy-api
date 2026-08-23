import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideExperimentalZonelessChangeDetection } from '@angular/core';

import { AlphaVantageStore } from './alpha-vantage.store';
import { AlphaVantageDataService } from '../services/alpha-vantage-data.service';
import { API_BASES, type ApiBases } from '../../../core/api/api.tokens';
import { AlphaVantageEndpoint } from '@shared/alpha-vantage';

describe('AlphaVantageStore — global endpoint support', () => {
  let store: InstanceType<typeof AlphaVantageStore>;
  let httpMock: HttpTestingController;

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
        AlphaVantageDataService,
      ],
    });
    store = TestBed.inject(AlphaVantageStore);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    try { httpMock.verify(); } catch { /* cancelled requests may remain */ }
  });

  it('skips symbol requirement for EARNINGS_CALENDAR (global endpoint)', () => {
    store.setEndpoint(AlphaVantageEndpoint.EARNINGS_CALENDAR);
    // No symbol set — should not error
    store.fetchData();

    const req = httpMock.expectOne((r) => r.url.includes('EARNINGS_CALENDAR'));
    expect(req.request.params.get('symbol')).toBeNull(); // no symbol in request
    req.flush({ ok: true, data: [], symbol: '', endpoint: AlphaVantageEndpoint.EARNINGS_CALENDAR, timestamp: new Date().toISOString() });
  });

  it('requires symbol for EARNINGS (per-symbol endpoint)', () => {
    store.setEndpoint(AlphaVantageEndpoint.EARNINGS);
    store.fetchData();

    // Should set error, not make HTTP request
    expect(store.error()).toContain('No symbol provided');
    httpMock.expectNone((r) => r.url.includes('EARNINGS'));
  });

  it('requires symbol for EARNINGS_ESTIMATES (per-symbol endpoint)', () => {
    store.setEndpoint(AlphaVantageEndpoint.EARNINGS_ESTIMATES);
    store.fetchData();

    expect(store.error()).toContain('No symbol provided');
    httpMock.expectNone((r) => r.url.includes('EARNINGS_ESTIMATES'));
  });

  it('includes symbol in request for per-symbol endpoints', () => {
    store.setEndpoint(AlphaVantageEndpoint.EARNINGS);
    store.setSymbol('AAPL');
    store.fetchData();

    const req = httpMock.expectOne((r) => r.url.includes('EARNINGS'));
    // The data service appends params to the URL via URLSearchParams, not HttpParams
    expect(req.request.urlWithParams).toContain('symbol=AAPL');
    req.flush({ ok: true, data: {}, symbol: 'AAPL', endpoint: AlphaVantageEndpoint.EARNINGS, timestamp: new Date().toISOString() });
  });
});

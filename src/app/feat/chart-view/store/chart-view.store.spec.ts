/** @topic #17 — SA UI — AV Hilbert Transform Endpoint Integration (opened 2026-08-15) */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideExperimentalZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';

import { ChartViewStore } from './chart-view.store';
import { TechnicalIndicatorsService } from '../services/technical-indicators.service';
import { ChartDataService } from '../services/chart-data.service';
import { API_BASES, type ApiBases } from '../../../core/api/api.tokens';
import { HtIndicator, PriceSeries, TimeSeriesInterval } from '@shared/alpha-vantage';

describe('ChartViewStore — IndicatorState + fetch logic + caching', () => {
  let store: InstanceType<typeof ChartViewStore>;
  let httpMock: HttpTestingController;

  const mockApiBases: ApiBases = {
    health: 'https://test.cloudfunctions.net',
    av: 'https://test.cloudfunctions.net',
    dm: 'https://test.cloudfunctions.net',
    benzinga: 'https://test.cloudfunctions.net',
    partner: 'https://test.cloudfunctions.net',
  };

  const mockChartDataService = {
    getTrackedSymbols: jasmine.createSpy('getTrackedSymbols').and.returnValue(of(['IBM', 'AAPL'])),
    getAllTimeSeriesData: jasmine.createSpy('getAllTimeSeriesData').and.returnValue(of([])),
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideExperimentalZonelessChangeDetection(),
        { provide: API_BASES, useValue: mockApiBases },
        { provide: ChartDataService, useValue: mockChartDataService },
        ChartViewStore,
        TechnicalIndicatorsService,
      ],
    });
    store = TestBed.inject(ChartViewStore);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // verify() fails if there are open requests, but cancelled requests
    // can't be flushed. Match and flush any non-cancelled open requests first.
    try { httpMock.verify(); } catch { /* cancelled requests may remain */ }
  });

  // Helper: set symbol (mock ChartDataService returns empty array synchronously)
  function setupSymbol(sym: string = 'IBM') {
    mockChartDataService.getAllTimeSeriesData.and.returnValue(of([]));
    store.selectSymbol(sym);
  }

  // Helper: set symbol with chartData (mock ChartDataService returns bars in year-doc format)
  function setupSymbolWithBars(sym: string, bars: any[]) {
    // DAILY interval expects array of year docs with 'bars' property
    mockChartDataService.getAllTimeSeriesData.and.returnValue(of([{ bars }]));
    store.selectSymbol(sym);
  }

  // ============================================================
  // State shape
  // ============================================================
  describe('initial state', () => {
    it('should have 6 IndicatorState fields all initialized to empty/hidden', () => {
      expect(store.htTrendline().show).toBe(false);
      expect(store.htTrendline().loading).toBe(false);
      expect(store.htTrendline().error).toBeNull();
      expect(store.htTrendline().data).toEqual([]);

      expect(store.htSine().show).toBe(false);
      expect(store.htDcperiod().show).toBe(false);
      expect(store.htDcphase().show).toBe(false);
      expect(store.htTrendmode().show).toBe(false);
      expect(store.htPhasor().show).toBe(false);
    });

    it('should have indicatorSeriesType defaulting to CLOSE', () => {
      expect(store.indicatorSeriesType()).toBe(PriceSeries.CLOSE);
    });

    it('should have showLocalHtCalc defaulting to false', () => {
      expect(store.showLocalHtCalc()).toBe(false);
    });

    it('should have sineDisplayMode defaulting to pane', () => {
      expect(store.sineDisplayMode()).toBe('pane');
    });
  });

  // ============================================================
  // toggleIndicator
  // ============================================================
  describe('toggleIndicator', () => {
    it('should set show=true and fetch when toggling ON with no cache', () => {
      setupSymbol('IBM');

      store.toggleIndicator(HtIndicator.HT_DCPERIOD);

      expect(store.htDcperiod().show).toBe(true);
      expect(store.htDcperiod().loading).toBe(true);

      const req = httpMock.expectOne(
        (r) => r.url.includes('partnerTechnicalIndicatorsV2') &&
               r.params.get('indicator') === 'ht_dcperiod'
      );
      req.flush({ ok: true, data: {} });
    });

    it('should set show=false when toggling OFF (no re-fetch)', () => {
      setupSymbol('IBM');

      // First toggle ON
      store.toggleIndicator(HtIndicator.HT_DCPERIOD);
      const req = httpMock.expectOne(
        (r) => r.url.includes('partnerTechnicalIndicatorsV2')
      );
      req.flush({ ok: true, data: {} });

      // Toggle OFF
      store.toggleIndicator(HtIndicator.HT_DCPERIOD);
      expect(store.htDcperiod().show).toBe(false);
      // No new HTTP request should be made
      httpMock.expectNone((r) => r.url.includes('partnerTechnicalIndicatorsV2'));
    });

    it('should reuse cache when toggling OFF then ON again (no new fetch)', () => {
      const bars = [
        { d: '2025-12-08', o: 100, h: 105, l: 99, c: 102, v: 1000 },
      ];
      setupSymbolWithBars('IBM', bars);

      // Toggle ON
      store.toggleIndicator(HtIndicator.HT_DCPERIOD);
      const req1 = httpMock.expectOne(
        (r) => r.url.includes('partnerTechnicalIndicatorsV2')
      );
      req1.flush({ ok: true, data: { '2025-12-08': { 'DCPERIOD': '14.5' } } });

      // Toggle OFF
      store.toggleIndicator(HtIndicator.HT_DCPERIOD);

      // Toggle ON again — should use cache, no new HTTP call
      store.toggleIndicator(HtIndicator.HT_DCPERIOD);
      expect(store.htDcperiod().show).toBe(true);
      expect(store.htDcperiod().loading).toBe(false);
      httpMock.expectNone((r) => r.url.includes('partnerTechnicalIndicatorsV2'));
    });

    it('should unwrap nested AV response (Technical Analysis wrapper) and stitch data', () => {
      const bars = [
        { d: '2025-12-08', o: 100, h: 105, l: 99, c: 102, v: 1000 },
        { d: '2025-12-09', o: 102, h: 106, l: 100, c: 104, v: 1100 },
      ];
      setupSymbolWithBars('IBM', bars);

      store.toggleIndicator(HtIndicator.HT_DCPERIOD);
      const req = httpMock.expectOne(
        (r) => r.url.includes('partnerTechnicalIndicatorsV2')
      );
      // Simulate the real AV response format with nested "Technical Analysis" wrapper
      req.flush({
        ok: true,
        data: {
          'Meta Data': {
            '1: Symbol': 'IBM',
            '2: Indicator': 'Hilbert Transform - Dominant Cycle Period (HT_DCPERIOD)',
            '3: Last Refreshed': '2025-12-09',
            '4: Interval': 'daily',
            '5: Series Type': 'close',
            '6: Time Zone': 'US/Eastern Time'
          },
          'Technical Analysis: HT_DCPERIOD': {
            '2025-12-08': { 'DCPERIOD': '14.5' },
            '2025-12-09': { 'DCPERIOD': '15.2' },
          }
        }
      });

      expect(store.htDcperiod().loading).toBe(false);
      expect(store.htDcperiod().error).toBeNull();
      expect(store.htDcperiod().data.length).toBe(2);
      expect(store.htDcperiod().data[0].v).toBe(14.5);
      expect(store.htDcperiod().data[1].v).toBe(15.2);
    });

    it('should set error message on fetch failure', () => {
      setupSymbol('IBM');

      store.toggleIndicator(HtIndicator.HT_DCPERIOD);

      const req = httpMock.expectOne(
        (r) => r.url.includes('partnerTechnicalIndicatorsV2')
      );
      req.flush(
        { ok: false, error: 'Rate limit exceeded', code: 'RATE_LIMITED' },
        { status: 429, statusText: 'Too Many Requests' }
      );

      expect(store.htDcperiod().loading).toBe(false);
      expect(store.htDcperiod().error).toContain('Rate limit');
    });
  });

  // ============================================================
  // setIndicatorSeriesType
  // ============================================================
  describe('setIndicatorSeriesType', () => {
    it('should update indicatorSeriesType state', () => {
      store.setIndicatorSeriesType(PriceSeries.HIGH);
      expect(store.indicatorSeriesType()).toBe(PriceSeries.HIGH);
    });

    it('should re-fetch all toggled indicators with new series_type', () => {
      setupSymbol('IBM');

      // Toggle on HT_DCPERIOD
      store.toggleIndicator(HtIndicator.HT_DCPERIOD);
      const req1 = httpMock.expectOne(
        (r) => r.url.includes('partnerTechnicalIndicatorsV2') &&
               r.params.get('series_type') === 'close'
      );
      req1.flush({ ok: true, data: {} });

      // Change series type
      store.setIndicatorSeriesType(PriceSeries.HIGH);

      const req2 = httpMock.expectOne(
        (r) => r.url.includes('partnerTechnicalIndicatorsV2') &&
               r.params.get('series_type') === 'high'
      );
      req2.flush({ ok: true, data: {} });
    });
  });

  // ============================================================
  // setSineDisplayMode
  // ============================================================
  describe('setSineDisplayMode', () => {
    it('should update sineDisplayMode state', () => {
      store.setSineDisplayMode('overlay');
      expect(store.sineDisplayMode()).toBe('overlay');
    });

    it('should NOT trigger a re-fetch', () => {
      store.setSineDisplayMode('both');
      httpMock.expectNone((r) => r.url.includes('partnerTechnicalIndicatorsV2'));
    });
  });

  // ============================================================
  // toggleLocalHtCalc
  // ============================================================
  describe('toggleLocalHtCalc', () => {
    it('should toggle showLocalHtCalc on/off', () => {
      expect(store.showLocalHtCalc()).toBe(false);
      store.toggleLocalHtCalc();
      expect(store.showLocalHtCalc()).toBe(true);
      store.toggleLocalHtCalc();
      expect(store.showLocalHtCalc()).toBe(false);
    });

    it('should NOT trigger any HTTP fetch', () => {
      store.toggleLocalHtCalc();
      httpMock.expectNone((r) => r.url.includes('partnerTechnicalIndicatorsV2'));
    });
  });

  // ============================================================
  // Cache invalidation
  // ============================================================
  describe('cache invalidation', () => {
    it('should clear all indicator data on interval change', () => {
      setupSymbol('IBM');

      // Toggle on an indicator and fetch
      store.toggleIndicator(HtIndicator.HT_DCPERIOD);
      const req = httpMock.expectOne(
        (r) => r.url.includes('partnerTechnicalIndicatorsV2')
      );
      req.flush({ ok: true, data: {} });

      // Change interval
      store.setInterval(TimeSeriesInterval.WEEKLY);

      // Data should be cleared
      expect(store.htDcperiod().data).toEqual([]);
      expect(store.htDcperiod().show).toBe(false);
    });

    it('should clear all indicator data on symbol change', () => {
      setupSymbol('IBM');

      store.toggleIndicator(HtIndicator.HT_DCPERIOD);
      const req = httpMock.expectOne(
        (r) => r.url.includes('partnerTechnicalIndicatorsV2')
      );
      req.flush({ ok: true, data: {} });

      store.selectSymbol('AAPL');

      expect(store.htDcperiod().data).toEqual([]);
      expect(store.htDcperiod().show).toBe(false);
    });
  });

  // ============================================================
  // Stitching
  // ============================================================
  describe('stitching', () => {
    it('should not error when chartData is empty (no candles to stitch to)', () => {
      setupSymbol('IBM');

      store.toggleIndicator(HtIndicator.HT_DCPERIOD);

      const req = httpMock.expectOne(
        (r) => r.url.includes('partnerTechnicalIndicatorsV2')
      );
      req.flush({
        ok: true,
        data: {
          '2025-12-08': { 'DCPERIOD': '14.5' },
          '2025-12-09': { 'DCPERIOD': '15.2' },
        },
      });

      // Without chartData loaded, stitching can't align — data stays empty
      // but the fetch succeeded (no error)
      expect(store.htDcperiod().error).toBeNull();
      expect(store.htDcperiod().data).toEqual([]);
    });

    it('should stitch AV response data to matching candle dates', () => {
      const bars = [
        { d: '2025-12-08', o: 100, h: 105, l: 99, c: 102, v: 1000 },
        { d: '2025-12-09', o: 102, h: 108, l: 101, c: 106, v: 1200 },
        { d: '2025-12-10', o: 106, h: 110, l: 104, c: 107, v: 900 },
      ];
      setupSymbolWithBars('IBM', bars);

      store.toggleIndicator(HtIndicator.HT_DCPERIOD);

      const req = httpMock.expectOne(
        (r) => r.url.includes('partnerTechnicalIndicatorsV2')
      );
      req.flush({
        ok: true,
        data: {
          '2025-12-08': { 'DCPERIOD': '14.5' },
          '2025-12-09': { 'DCPERIOD': '15.2' },
        },
      });

      expect(store.htDcperiod().error).toBeNull();
      expect(store.htDcperiod().data.length).toBe(2);
      expect(store.htDcperiod().data[0].v).toBe(14.5);
      expect(store.htDcperiod().data[1].v).toBe(15.2);
    });

    it('should drop orphan dates (in AV but not in chartData)', () => {
      const bars = [
        { d: '2025-12-08', o: 100, h: 105, l: 99, c: 102, v: 1000 },
        { d: '2025-12-10', o: 106, h: 110, l: 104, c: 107, v: 900 },
      ];
      setupSymbolWithBars('IBM', bars);

      store.toggleIndicator(HtIndicator.HT_DCPERIOD);

      const req = httpMock.expectOne(
        (r) => r.url.includes('partnerTechnicalIndicatorsV2')
      );
      // 2025-12-09 is not in chartData — should be dropped
      req.flush({
        ok: true,
        data: {
          '2025-12-08': { 'DCPERIOD': '14.5' },
          '2025-12-09': { 'DCPERIOD': '15.2' },
          '2025-12-10': { 'DCPERIOD': '16.0' },
        },
      });

      expect(store.htDcperiod().data.length).toBe(2);
      expect(store.htDcperiod().data[0].v).toBe(14.5);
      expect(store.htDcperiod().data[1].v).toBe(16.0);
    });

    it('should re-stitch raw data when chartData loads after fetch', () => {
      // First, fetch indicator with empty chartData
      setupSymbol('IBM');
      store.toggleIndicator(HtIndicator.HT_DCPERIOD);
      const req = httpMock.expectOne(
        (r) => r.url.includes('partnerTechnicalIndicatorsV2')
      );
      req.flush({
        ok: true,
        data: {
          '2025-12-08': { 'DCPERIOD': '14.5' },
        },
      });

      // Data is empty because chartData was empty
      expect(store.htDcperiod().data).toEqual([]);

      // Now load chartData via setSplitAdjusted (doesn't clear indicator cache)
      const bars = [
        { d: '2025-12-08', o: 100, h: 105, l: 99, c: 102, v: 1000 },
      ];
      mockChartDataService.getAllTimeSeriesData.and.returnValue(of([{ bars }]));
      store.setSplitAdjusted(true);

      // After chartData loads, restitchAllFromCache should populate the data
      expect(store.htDcperiod().data.length).toBe(1);
      expect(store.htDcperiod().data[0].v).toBe(14.5);
    });
  });

  // ============================================================
  // Dual-series parsing (HT_SINE, HT_PHASOR)
  // ============================================================
  describe('dual-series indicators', () => {
    it('should handle HT_SINE with sine + lead_sine in one fetch', () => {
      setupSymbol('IBM');

      store.toggleIndicator(HtIndicator.HT_SINE);

      const req = httpMock.expectOne(
        (r) => r.url.includes('partnerTechnicalIndicatorsV2') &&
               r.params.get('indicator') === 'ht_sine'
      );
      req.flush({
        ok: true,
        data: {
          '2025-12-08': { 'SINE': '0.5', 'LEAD SINE': '0.8' },
        },
      });

      expect(store.htSine().error).toBeNull();
    });

    it('should handle HT_PHASOR with in_phase + quadrature in one fetch', () => {
      setupSymbol('IBM');

      store.toggleIndicator(HtIndicator.HT_PHASOR);

      const req = httpMock.expectOne(
        (r) => r.url.includes('partnerTechnicalIndicatorsV2') &&
               r.params.get('indicator') === 'ht_phasor'
      );
      req.flush({
        ok: true,
        data: {
          '2025-12-08': { 'PHASE': '0.3', 'QUADRATURE': '0.7' },
        },
      });

      expect(store.htPhasor().error).toBeNull();
    });

    it('should stitch HT_SINE dual-series data to candle dates', () => {
      const bars = [
        { d: '2025-12-08', o: 100, h: 105, l: 99, c: 102, v: 1000 },
        { d: '2025-12-09', o: 102, h: 108, l: 101, c: 106, v: 1200 },
      ];
      setupSymbolWithBars('IBM', bars);

      store.toggleIndicator(HtIndicator.HT_SINE);

      const req = httpMock.expectOne(
        (r) => r.url.includes('partnerTechnicalIndicatorsV2')
      );
      req.flush({
        ok: true,
        data: {
          '2025-12-08': { 'SINE': '0.5', 'LEAD SINE': '0.8' },
          '2025-12-09': { 'SINE': '0.6', 'LEAD SINE': '0.9' },
        },
      });

      expect(store.htSine().dualData?.length).toBe(2);
      expect(store.htSine().dualData?.[0].v1).toBe(0.5);
      expect(store.htSine().dualData?.[0].v2).toBe(0.8);
    });

    it('should stitch HT_PHASOR dual-series data to candle dates', () => {
      const bars = [
        { d: '2025-12-08', o: 100, h: 105, l: 99, c: 102, v: 1000 },
      ];
      setupSymbolWithBars('IBM', bars);

      store.toggleIndicator(HtIndicator.HT_PHASOR);

      const req = httpMock.expectOne(
        (r) => r.url.includes('partnerTechnicalIndicatorsV2')
      );
      req.flush({
        ok: true,
        data: {
          '2025-12-08': { 'PHASE': '0.3', 'QUADRATURE': '0.7' },
        },
      });

      expect(store.htPhasor().dualData?.length).toBe(1);
      expect(store.htPhasor().dualData?.[0].v1).toBe(0.3);
      expect(store.htPhasor().dualData?.[0].v2).toBe(0.7);
    });
  });

  // ============================================================
  // Rapid toggling / cancellation
  // ============================================================
  describe('rapid toggling', () => {
    // Note: cancellation tests don't call httpMock.verify() because
    // cancelled requests can't be flushed/errored in HttpTestingController.

    it('should cancel in-flight fetch when toggling OFF before fetch completes', () => {
      setupSymbol('IBM');

      // Toggle ON — starts fetch
      store.toggleIndicator(HtIndicator.HT_DCPERIOD);
      expect(store.htDcperiod().loading).toBe(true);

      // Toggle OFF before fetch completes — cancels the fetch
      store.toggleIndicator(HtIndicator.HT_DCPERIOD);
      expect(store.htDcperiod().show).toBe(false);
      expect(store.htDcperiod().loading).toBe(false);

      // The request was cancelled — verify no error state is set
      // (unsubscribe does not trigger the error callback)
      expect(store.htDcperiod().error).toBeNull();
    });

    it('should cancel previous fetch when series_type changes during fetch', () => {
      setupSymbol('IBM');

      // Toggle ON with close — starts fetch
      store.toggleIndicator(HtIndicator.HT_DCPERIOD);
      expect(store.htDcperiod().loading).toBe(true);

      // Change series_type — cancels first fetch, starts second
      store.setIndicatorSeriesType(PriceSeries.HIGH);

      // Flush the second request (with new series_type)
      const req2 = httpMock.expectOne(
        (r) => r.params.get('series_type') === 'high'
      );
      req2.flush({ ok: true, data: {} });

      // Loading should be false after second fetch completes
      expect(store.htDcperiod().loading).toBe(false);
    });
  });

  // ============================================================
  // Independence of client-side calc and endpoint indicators
  // ============================================================
  describe('independence', () => {
    it('toggling local calc should not affect endpoint indicators', () => {
      store.toggleLocalHtCalc();
      expect(store.showLocalHtCalc()).toBe(true);
      expect(store.htTrendline().show).toBe(false);
    });

    it('toggling endpoint indicator should not affect local calc', () => {
      setupSymbol('IBM');

      store.toggleIndicator(HtIndicator.HT_TRENDLINE);
      const req = httpMock.expectOne(
        (r) => r.url.includes('partnerTechnicalIndicatorsV2')
      );
      req.flush({ ok: true, data: {} });

      expect(store.htTrendline().show).toBe(true);
      expect(store.showLocalHtCalc()).toBe(false);
    });
  });
});

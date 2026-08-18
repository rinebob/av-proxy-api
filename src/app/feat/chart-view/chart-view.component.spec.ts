/**
 * @topic #17 — SA UI — AV Hilbert Transform Endpoint Integration (opened 2026-08-15)
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideExperimentalZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import { ComponentFixture } from '@angular/core/testing';
import { patchState } from '@ngrx/signals';

import { ChartViewComponent } from './chart-view.component';
import { ChartViewStore } from './store/chart-view.store';
import { ChartDataService } from './services/chart-data.service';
import { API_BASES, type ApiBases } from '../../core/api/api.tokens';
import { HtIndicator, PriceSeries, TimeSeriesInterval } from '@shared/alpha-vantage';

describe('ChartViewComponent — indicator toggle controls', () => {
  let fixture: ComponentFixture<ChartViewComponent>;
  let component: ChartViewComponent;

  const mockApiBases: ApiBases = {
    health: 'https://test.cloudfunctions.net',
    av: 'https://test.cloudfunctions.net',
    dm: 'https://test.cloudfunctions.net',
    benzinga: 'https://test.cloudfunctions.net',
    partner: 'https://test.cloudfunctions.net',
  };

  const mockChartDataService = {
    getTrackedSymbols: jasmine.createSpy('getTrackedSymbols').and.returnValue(of(['IBM'])),
    getAllTimeSeriesData: jasmine.createSpy('getAllTimeSeriesData').and.returnValue(of([])),
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ChartViewComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideExperimentalZonelessChangeDetection(),
        { provide: API_BASES, useValue: mockApiBases },
        { provide: ChartDataService, useValue: mockChartDataService },
      ],
    });
    fixture = TestBed.createComponent(ChartViewComponent);
    component = fixture.componentInstance;
  });

  /** Helper: the component's own store instance (provided in component providers). */
  function store(): any {
    return component.store;
  }

  // ============================================================
  // Component creation
  // ============================================================
  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // ============================================================
  // IB-3: Toggle UI calls correct store method
  // ============================================================
  describe('indicator toggle handlers', () => {
    it('onIndicatorToggle should call store.toggleIndicator with correct key', () => {
      spyOn(store(), 'toggleIndicator');
      component.onIndicatorToggle(HtIndicator.HT_DCPERIOD);
      expect(store().toggleIndicator).toHaveBeenCalledWith(HtIndicator.HT_DCPERIOD);
    });

    it('onIndicatorToggle should call store.toggleIndicator for each indicator', () => {
      spyOn(store(), 'toggleIndicator');
      const keys = [
        HtIndicator.HT_TRENDLINE,
        HtIndicator.HT_SINE,
        HtIndicator.HT_DCPERIOD,
        HtIndicator.HT_DCPHASE,
        HtIndicator.HT_TRENDMODE,
        HtIndicator.HT_PHASOR,
      ];
      for (const key of keys) {
        component.onIndicatorToggle(key);
      }
      expect(store().toggleIndicator).toHaveBeenCalledTimes(6);
      expect(store().toggleIndicator).toHaveBeenCalledWith(HtIndicator.HT_TRENDLINE);
      expect(store().toggleIndicator).toHaveBeenCalledWith(HtIndicator.HT_PHASOR);
    });

    it('onLocalHtCalcToggle should call store.toggleLocalHtCalc', () => {
      spyOn(store(), 'toggleLocalHtCalc');
      component.onLocalHtCalcToggle();
      expect(store().toggleLocalHtCalc).toHaveBeenCalled();
    });
  });

  // ============================================================
  // IB-3: Series type dropdown calls setIndicatorSeriesType
  // ============================================================
  describe('series type dropdown', () => {
    it('onSeriesTypeChange should call store.setIndicatorSeriesType with correct type', () => {
      spyOn(store(), 'setIndicatorSeriesType');
      component.onSeriesTypeChange(PriceSeries.HIGH);
      expect(store().setIndicatorSeriesType).toHaveBeenCalledWith(PriceSeries.HIGH);
    });

    it('onSeriesTypeChange should accept all 4 price series types', () => {
      spyOn(store(), 'setIndicatorSeriesType');
      component.onSeriesTypeChange(PriceSeries.CLOSE);
      component.onSeriesTypeChange(PriceSeries.OPEN);
      component.onSeriesTypeChange(PriceSeries.HIGH);
      component.onSeriesTypeChange(PriceSeries.LOW);
      expect(store().setIndicatorSeriesType).toHaveBeenCalledTimes(4);
    });
  });

  // ============================================================
  // IB-3: Sine display mode toggle calls setSineDisplayMode
  // ============================================================
  describe('sine display mode', () => {
    it('onSineDisplayModeChange should call store.setSineDisplayMode with correct mode', () => {
      spyOn(store(), 'setSineDisplayMode');
      component.onSineDisplayModeChange('overlay');
      expect(store().setSineDisplayMode).toHaveBeenCalledWith('overlay');
    });

    it('onSineDisplayModeChange should accept all 3 modes', () => {
      spyOn(store(), 'setSineDisplayMode');
      component.onSineDisplayModeChange('pane');
      component.onSineDisplayModeChange('overlay');
      component.onSineDisplayModeChange('both');
      expect(store().setSineDisplayMode).toHaveBeenCalledTimes(3);
    });
  });

  // ============================================================
  // IB-3: Loading state reflects in toggle UI
  // ============================================================
  describe('loading state', () => {
    it('indicatorToggles should reflect loading state from store', () => {
      const toggles = component.indicatorToggles();
      const dcPeriod = toggles.find(t => t.key === HtIndicator.HT_DCPERIOD);
      expect(dcPeriod?.state.loading).toBe(false);
    });
  });

  // ============================================================
  // IB-3: Error state reflects in toggle UI
  // ============================================================
  describe('error state', () => {
    it('indicatorToggles should reflect error state from store', () => {
      const toggles = component.indicatorToggles();
      const dcPeriod = toggles.find(t => t.key === HtIndicator.HT_DCPERIOD);
      expect(dcPeriod?.state.error).toBeNull();
    });

    it('indicatorToggles should reflect show state from store', () => {
      const toggles = component.indicatorToggles();
      const dcPeriod = toggles.find(t => t.key === HtIndicator.HT_DCPERIOD);
      expect(dcPeriod?.state.show).toBe(false);
    });
  });

  // ============================================================
  // Indicator metadata (computed signal)
  // ============================================================
  describe('indicator metadata', () => {
    it('should expose all 6 indicator toggles with correct keys', () => {
      const toggles = component.indicatorToggles();
      expect(toggles.length).toBe(6);
      const keys = toggles.map(t => t.key);
      expect(keys).toContain(HtIndicator.HT_TRENDLINE);
      expect(keys).toContain(HtIndicator.HT_SINE);
      expect(keys).toContain(HtIndicator.HT_DCPERIOD);
      expect(keys).toContain(HtIndicator.HT_DCPHASE);
      expect(keys).toContain(HtIndicator.HT_TRENDMODE);
      expect(keys).toContain(HtIndicator.HT_PHASOR);
    });

    it('should have display labels for all 6 indicators', () => {
      const toggles = component.indicatorToggles();
      const byKey = new Map(toggles.map(t => [t.key, t.label]));
      expect(byKey.get(HtIndicator.HT_TRENDLINE)).toBe('Trendline');
      expect(byKey.get(HtIndicator.HT_SINE)).toBe('Sine');
      expect(byKey.get(HtIndicator.HT_DCPERIOD)).toBe('DC Period');
      expect(byKey.get(HtIndicator.HT_DCPHASE)).toBe('DC Phase');
      expect(byKey.get(HtIndicator.HT_TRENDMODE)).toBe('Trend Mode');
      expect(byKey.get(HtIndicator.HT_PHASOR)).toBe('Phasor');
    });
  });

  // ============================================================
  // IB-3: Error toast notification
  // ============================================================
  describe('error toast', () => {
    it('showIndicatorError should call snackBar.open with error message', () => {
      const snackBar = (component as any).snackBar;
      spyOn(snackBar, 'open');
      (component as any).showIndicatorError('Rate limit exceeded');
      expect(snackBar.open).toHaveBeenCalledWith(
        'Indicator error: Rate limit exceeded',
        'Dismiss',
        { duration: 5000, panelClass: ['indicator-error-toast'] },
      );
    });

    it('showIndicatorError should not have been called on initial load (no errors)', () => {
      // The effect runs on component creation. With no errors in the store,
      // snackBar.open should not have been called.
      const snackBar = (component as any).snackBar;
      spyOn(snackBar, 'open');
      // Trigger the effect again by reading indicatorToggles
      component.indicatorToggles();
      expect(snackBar.open).not.toHaveBeenCalled();
    });

    it('showIndicatorError should format the message with "Indicator error:" prefix', () => {
      const snackBar = (component as any).snackBar;
      spyOn(snackBar, 'open');
      (component as any).showIndicatorError('Invalid API key');
      const args = snackBar.open.calls.mostRecent().args;
      expect(args[0]).toContain('Invalid API key');
      expect(args[0]).toContain('Indicator error:');
    });
  });

  // ============================================================
  // Task #26: Multi-pane chart layout — computed signals
  // ============================================================
  describe('multi-pane chart layout', () => {
    describe('chartRows', () => {
      it('should always emit 6 rows (5 fixed lower panes + price) even when no indicators are on', () => {
        const rows = component.chartRows();
        expect(rows.length).toBe(6);
        // First 5 rows are lower panes (0% when inactive), last row is price (100% when no indicators)
        expect((rows[0] as any).height).toBe('0.0%');
        expect((rows[1] as any).height).toBe('0.0%');
        expect((rows[2] as any).height).toBe('0.0%');
        expect((rows[3] as any).height).toBe('0.0%');
        expect((rows[4] as any).height).toBe('0.0%');
        expect((rows[5] as any).height).toBe('100.0%');
      });

      it('should give non-zero height to a lower pane when HT_PHASOR is toggled on', () => {
        const s = store();
        patchState(s,{ htPhasor: { ...s.htPhasor(), show: true } } as any);
        const rows = component.chartRows();
        expect(rows.length).toBe(6);
        // Phasor is slot 4 (rowIndex 4)
        expect(parseFloat((rows[4] as any).height)).toBeGreaterThan(0);
      });

      it('should give non-zero height to a lower pane when HT_TRENDMODE is toggled on', () => {
        const s = store();
        patchState(s,{ htTrendmode: { ...s.htTrendmode(), show: true } } as any);
        const rows = component.chartRows();
        expect(rows.length).toBe(6);
        // Trendmode is slot 3 (rowIndex 3)
        expect(parseFloat((rows[3] as any).height)).toBeGreaterThan(0);
      });

      it('should give non-zero height to SinePane slot when HT_SINE is in pane mode', () => {
        const s = store();
        patchState(s,{
          htSine: { ...s.htSine(), show: true },
          sineDisplayMode: 'pane'
        } as any);
        const rows = component.chartRows();
        expect(rows.length).toBe(6);
        // SinePane is slot 2 (rowIndex 2)
        expect(parseFloat((rows[2] as any).height)).toBeGreaterThan(0);
      });

      it('should NOT give height to SinePane slot when HT_SINE is in overlay mode', () => {
        const s = store();
        patchState(s,{
          htSine: { ...s.htSine(), show: true },
          sineDisplayMode: 'overlay'
        } as any);
        const rows = component.chartRows();
        expect(rows.length).toBe(6);
        // SinePane slot stays 0% in overlay mode
        expect((rows[2] as any).height).toBe('0.0%');
      });

      it('should give height to SinePane slot when HT_SINE is in both mode', () => {
        const s = store();
        patchState(s,{
          htSine: { ...s.htSine(), show: true },
          sineDisplayMode: 'both'
        } as any);
        const rows = component.chartRows();
        expect(rows.length).toBe(6);
        expect(parseFloat((rows[2] as any).height)).toBeGreaterThan(0);
      });

      it('should give height to all lower panes when all indicators are on', () => {
        const s = store();
        patchState(s,{
          htPhasor: { ...s.htPhasor(), show: true },
          htTrendmode: { ...s.htTrendmode(), show: true },
          htSine: { ...s.htSine(), show: true },
          sineDisplayMode: 'pane',
          htDcperiod: { ...s.htDcperiod(), show: true },
          htDcphase: { ...s.htDcphase(), show: true },
        } as any);
        const rows = component.chartRows();
        expect(rows.length).toBe(6);
        // All 5 lower panes should have non-zero height
        for (let i = 0; i < 5; i++) {
          expect(parseFloat((rows[i] as any).height)).toBeGreaterThan(0);
        }
      });
    });

    describe('chartAxes', () => {
      it('should always include SecondaryYAxis at rowIndex 5 (price row)', () => {
        const axes = component.chartAxes();
        const secondary = axes.find((a: any) => a.name === 'SecondaryYAxis');
        expect(secondary).toBeTruthy();
        expect((secondary as any).rowIndex).toBe(5);
      });

      it('should always include all 5 lower-pane axes even when no indicators are on', () => {
        const axes = component.chartAxes();
        const names = axes.map((a: any) => a.name);
        expect(names).toContain('DcphaseAxis');
        expect(names).toContain('DcperiodAxis');
        expect(names).toContain('SinePaneAxis');
        expect(names).toContain('TrendmodeAxis');
        expect(names).toContain('PhasorAxis');
      });

      it('should include SineAxis when showLocalHtCalc is true', () => {
        const s = store();
        patchState(s,{ showLocalHtCalc: true } as any);
        const axes = component.chartAxes();
        const sineAxis = axes.find((a: any) => a.name === 'SineAxis');
        expect(sineAxis).toBeTruthy();
        expect((sineAxis as any).rowIndex).toBe(5);
      });

      it('should include SineAxis when HT_SINE is in overlay mode', () => {
        const s = store();
        patchState(s,{
          htSine: { ...s.htSine(), show: true },
          sineDisplayMode: 'overlay'
        } as any);
        const axes = component.chartAxes();
        const sineAxis = axes.find((a: any) => a.name === 'SineAxis');
        expect(sineAxis).toBeTruthy();
      });

      it('should always include PhasorAxis at fixed rowIndex 4', () => {
        const s = store();
        patchState(s,{ htPhasor: { ...s.htPhasor(), show: true } } as any);
        const axes = component.chartAxes();
        const phasorAxis = axes.find((a: any) => a.name === 'PhasorAxis');
        expect(phasorAxis).toBeTruthy();
        expect((phasorAxis as any).rowIndex).toBe(4);
      });

      it('should always include TrendmodeAxis with fixed 0-1 range at rowIndex 3', () => {
        const s = store();
        patchState(s,{ htTrendmode: { ...s.htTrendmode(), show: true } } as any);
        const axes = component.chartAxes();
        const trendmodeAxis = axes.find((a: any) => a.name === 'TrendmodeAxis');
        expect(trendmodeAxis).toBeTruthy();
        expect((trendmodeAxis as any).rowIndex).toBe(3);
        expect((trendmodeAxis as any).minimum).toBe(0);
        expect((trendmodeAxis as any).maximum).toBe(1);
      });

      it('should always include SinePaneAxis at rowIndex 2 with -1..1 range', () => {
        const s = store();
        patchState(s,{
          htSine: { ...s.htSine(), show: true },
          sineDisplayMode: 'pane'
        } as any);
        const axes = component.chartAxes();
        const sinePaneAxis = axes.find((a: any) => a.name === 'SinePaneAxis');
        expect(sinePaneAxis).toBeTruthy();
        expect((sinePaneAxis as any).rowIndex).toBe(2);
        expect((sinePaneAxis as any).minimum).toBe(-1);
        expect((sinePaneAxis as any).maximum).toBe(1);
      });

      it('should still include SinePaneAxis (inactive) when HT_SINE is in overlay mode', () => {
        const s = store();
        patchState(s,{
          htSine: { ...s.htSine(), show: true },
          sineDisplayMode: 'overlay'
        } as any);
        const axes = component.chartAxes();
        const sinePaneAxis = axes.find((a: any) => a.name === 'SinePaneAxis');
        // Fixed pane: axis always exists, just inactive (empty label, hidden grid)
        expect(sinePaneAxis).toBeTruthy();
        expect((sinePaneAxis as any).labelFormat).toBe('');
      });

      it('should always include DcperiodAxis at fixed rowIndex 1', () => {
        const s = store();
        patchState(s,{ htDcperiod: { ...s.htDcperiod(), show: true } } as any);
        const axes = component.chartAxes();
        const dcperiodAxis = axes.find((a: any) => a.name === 'DcperiodAxis');
        expect(dcperiodAxis).toBeTruthy();
        expect((dcperiodAxis as any).rowIndex).toBe(1);
      });

      it('should always include DcphaseAxis at fixed rowIndex 0', () => {
        const s = store();
        patchState(s,{ htDcphase: { ...s.htDcphase(), show: true } } as any);
        const axes = component.chartAxes();
        const dcphaseAxis = axes.find((a: any) => a.name === 'DcphaseAxis');
        expect(dcphaseAxis).toBeTruthy();
        expect((dcphaseAxis as any).rowIndex).toBe(0);
      });

      it('should assign correct fixed rowIndexes when all indicators are on', () => {
        const s = store();
        patchState(s,{
          htPhasor: { ...s.htPhasor(), show: true },
          htTrendmode: { ...s.htTrendmode(), show: true },
          htSine: { ...s.htSine(), show: true },
          sineDisplayMode: 'pane',
          htDcperiod: { ...s.htDcperiod(), show: true },
          htDcphase: { ...s.htDcphase(), show: true },
        } as any);
        const axes = component.chartAxes();
        const phasorAxis = axes.find((a: any) => a.name === 'PhasorAxis');
        const trendmodeAxis = axes.find((a: any) => a.name === 'TrendmodeAxis');
        const sinePaneAxis = axes.find((a: any) => a.name === 'SinePaneAxis');
        const dcperiodAxis = axes.find((a: any) => a.name === 'DcperiodAxis');
        const dcphaseAxis = axes.find((a: any) => a.name === 'DcphaseAxis');
        expect((dcphaseAxis as any).rowIndex).toBe(0);
        expect((dcperiodAxis as any).rowIndex).toBe(1);
        expect((sinePaneAxis as any).rowIndex).toBe(2);
        expect((trendmodeAxis as any).rowIndex).toBe(3);
        expect((phasorAxis as any).rowIndex).toBe(4);
      });
    });

    describe('endpoint indicator computed signals', () => {
      it('categoryHtTrendlineEndpoint should return empty when no data', () => {
        expect(component.categoryHtTrendlineEndpoint()).toEqual([]);
      });

      it('categoryHtDcperiod should return empty when no data', () => {
        expect(component.categoryHtDcperiod()).toEqual([]);
      });

      it('categoryHtDcphase should return empty when no data', () => {
        expect(component.categoryHtDcphase()).toEqual([]);
      });

      it('categoryHtTrendmode should return empty when no data', () => {
        expect(component.categoryHtTrendmode()).toEqual([]);
      });

      it('categoryHtSineEndpoint should return empty when no data', () => {
        expect(component.categoryHtSineEndpoint()).toEqual([]);
      });

      it('categoryHtPhasor should return empty when no data', () => {
        expect(component.categoryHtPhasor()).toEqual([]);
      });

      it('mapToCategoryIndex should stitch indicator data to category indices', () => {
        // Set up chart data with known dates
        const s = store();
        const date1 = new Date('2024-01-01');
        const date2 = new Date('2024-01-02');
        patchState(s,{
          chartData: [
            { t: date1, o: 100, h: 110, l: 95, c: 105 },
            { t: date2, o: 105, h: 115, l: 100, c: 110 },
          ]
        } as any);
        // Set up indicator data matching one date
        patchState(s,{
          htDcperiod: { show: true, loading: false, error: null, data: [{ t: date2, v: 14.5 }] }
        } as any);
        const result = component.categoryHtDcperiod();
        expect(result.length).toBe(1);
        expect(result[0].index).toBe(1);
        expect(result[0].v).toBe(14.5);
      });

      it('mapDualToCategoryIndex should stitch dual-series data (HT_PHASOR)', () => {
        const s = store();
        const date1 = new Date('2024-01-01');
        patchState(s,{
          chartData: [{ t: date1, o: 100, h: 110, l: 95, c: 105 }]
        } as any);
        patchState(s,{
          htPhasor: { show: true, loading: false, error: null, data: [], dualData: [{ t: date1, v1: 0.5, v2: -0.3 }] }
        } as any);
        const result = component.categoryHtPhasor();
        expect(result.length).toBe(1);
        expect(result[0].index).toBe(0);
        expect(result[0].v1).toBe(0.5);
        expect(result[0].v2).toBe(-0.3);
      });

      it('mapToCategoryIndex should drop indicator points with no matching date', () => {
        const s = store();
        const date1 = new Date('2024-01-01');
        const orphanDate = new Date('2023-12-31');
        patchState(s,{
          chartData: [{ t: date1, o: 100, h: 110, l: 95, c: 105 }]
        } as any);
        patchState(s,{
          htDcphase: { show: true, loading: false, error: null, data: [
            { t: date1, v: 45.0 },
            { t: orphanDate, v: 99.9 } // orphan — no matching bar
          ] }
        } as any);
        const result = component.categoryHtDcphase();
        expect(result.length).toBe(1);
        expect(result[0].v).toBe(45.0);
      });
    });
  });
});

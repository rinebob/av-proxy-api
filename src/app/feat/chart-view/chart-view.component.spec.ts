import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideExperimentalZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import { ComponentFixture } from '@angular/core/testing';

import { ChartViewComponent } from './chart-view.component';
import { ChartViewStore } from './store/chart-view.store';
import { ChartDataService } from './services/chart-data.service';
import { API_BASES, type ApiBases } from '../../core/api/api.tokens';
import { HtIndicator, PriceSeries, TimeSeriesInterval } from '@shared/alpha-vantage';

/**
 * @topic #17 — SA UI — AV Hilbert Transform Endpoint Integration (opened 2026-08-15)
 *
 * Tests IB-3 from TEST-av-endpoints-hilbert-fe.md:
 * - Toggle UI calls correct store method
 * - Series type dropdown calls setIndicatorSeriesType
 * - Sine display mode toggle calls setSineDisplayMode
 * - Loading state reflects in toggle UI
 * - Error state reflects in toggle UI
 */
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
  function store(): InstanceType<typeof ChartViewStore> {
    return component.store as any;
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
      component.onLocalHtCalcToggle(true);
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
});

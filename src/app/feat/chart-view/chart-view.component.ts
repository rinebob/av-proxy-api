import { Component, OnInit, inject, ViewChild, effect, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { FormsModule } from '@angular/forms';
import { ChartModule, ChartComponent, CandleSeriesService, LineSeriesService, CategoryService, TooltipService, ZoomService, CrosshairService, ZoomSettingsModel, IZoomCompleteEventArgs, IScrollEventArgs, ScrollBarService, IAxisLabelRenderEventArgs, ColumnSeriesService, ScatterSeriesService, AreaSeriesService, RangeAreaSeriesService, DateTimeService, LegendService, LogarithmicService } from '@syncfusion/ej2-angular-charts';
import { ChartViewStore, IndicatorState } from './store/chart-view.store';
import { HtIndicator, PriceSeries, SineDisplayMode, TimeSeriesInterval } from '@shared/alpha-vantage';

interface YAxisViewport {
  min: number;
  max: number;
}

/** Template-facing view model for a single endpoint indicator toggle. */
interface IndicatorToggleView {
  key: HtIndicator;
  label: string;
  state: IndicatorState;
}

@Component({
  selector: 'app-chart-view',
  standalone: true,
  imports: [
    CommonModule,
    MatFormFieldModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatButtonToggleModule,
    MatSnackBarModule,
    FormsModule,
    ChartModule
  ],
  providers: [
    ChartViewStore,
    CandleSeriesService,
    LineSeriesService,
    ColumnSeriesService,
    ScatterSeriesService,
    AreaSeriesService,
    RangeAreaSeriesService,
    DateTimeService,
    CategoryService,
    TooltipService,
    ZoomService,
    CrosshairService,
    ScrollBarService,
    LegendService,
    LogarithmicService
  ],
  templateUrl: './chart-view.component.html',
  styleUrls: ['./chart-view.component.scss']
})
export class ChartViewComponent implements OnInit {
  @ViewChild('chart') chart!: ChartComponent;
  readonly store = inject(ChartViewStore);
  private readonly snackBar = inject(MatSnackBar);
  readonly currentYear = new Date().getFullYear();
  readonly TimeSeriesInterval = TimeSeriesInterval;
  readonly HtIndicator = HtIndicator;
  readonly PriceSeries = PriceSeries;

  /** Master switch for the indicator controls (Local HT Calc toggle, series-type
   *  dropdown, 6 endpoint indicator buttons, sine display mode). Set to false to
   *  hide all indicator UI without removing the underlying code. */
  readonly showIndicatorControls = signal(false);

  /** All 6 endpoint indicators with their current state, for template iteration. */
  readonly indicatorToggles = computed<IndicatorToggleView[]>(() => {
    const s = this.store;
    return [
      { key: HtIndicator.HT_TRENDLINE, label: 'Trendline', state: s.htTrendline() },
      { key: HtIndicator.HT_SINE,      label: 'Sine',      state: s.htSine() },
      { key: HtIndicator.HT_DCPERIOD,  label: 'DC Period', state: s.htDcperiod() },
      { key: HtIndicator.HT_DCPHASE,   label: 'DC Phase',  state: s.htDcphase() },
      { key: HtIndicator.HT_TRENDMODE, label: 'Trend Mode',state: s.htTrendmode() },
      { key: HtIndicator.HT_PHASOR,    label: 'Phasor',    state: s.htPhasor() },
    ];
  });

  /** Whether HT_SINE should render in the lower pane (pane or both mode).
   *  Delegates to the static PANE_CONFIG predicate — single source of truth. */
  readonly sinePaneActive = computed(() => ChartViewComponent.sinePaneActive(this.store));

  /** Whether HT_SINE should render as an overlay on the price chart (overlay or both mode). */
  readonly sineOverlayActive = computed(() => {
    const s = this.store.htSine();
    const mode = this.store.sineDisplayMode();
    return s.show && (mode === 'overlay' || mode === 'both');
  });

  private isInitialLoad = true;

  // Y-axis viewport signal — the SINGLE source of truth for Y min/max.
  private yAxisViewport = signal<YAxisViewport | null>(null);

  // UI State for Zoom Mode
  isPanMode = true;

  // Category-indexed data for the candle series.
  // Maps each bar to { index, o, h, l, c, date } so the X-axis uses
  // integer indices (Category axis) with date labels — no weekend/holiday gaps.
  readonly categoryBars = computed(() => {
    const data = this.store.chartData();
    return data.map((bar: any, index: number) => ({
      index,
      o: bar.o,
      h: bar.h,
      l: bar.l,
      c: bar.c,
      date: bar.t
    }));
  });

  // ---- Date-stitching helper ----
  // Maps indicator data points (keyed by date) to category indices matching
  // the candle series. Drops any indicator points whose dates don't match a bar.
  private mapToCategoryIndex(htData: any[]): { index: number; v: number }[] {
    const bars = this.store.chartData();
    if (htData.length === 0 || bars.length === 0) return [];
    const dateToIndex = new Map<string, number>();
    bars.forEach((b: any, i: number) => dateToIndex.set(this.dateKey(b.t), i));
    const result = htData
      .map((p: any) => {
        const idx = dateToIndex.get(this.dateKey(p.t));
        return idx != null ? { index: idx, v: Number(p.v) } : null;
      })
      .filter((p): p is { index: number; v: number } => p != null);
    return result;
  }

  // Same helper for dual-series indicators (HT_SINE, HT_PHASOR) — maps {t, v1, v2}
  private mapDualToCategoryIndex(dualData: any[]): { index: number; v1: number; v2: number }[] {
    const bars = this.store.chartData();
    if (dualData.length === 0 || bars.length === 0) return [];
    const dateToIndex = new Map<string, number>();
    bars.forEach((b: any, i: number) => dateToIndex.set(this.dateKey(b.t), i));
    return dualData
      .map((p: any) => {
        const idx = dateToIndex.get(this.dateKey(p.t));
        return idx != null ? { index: idx, v1: Number(p.v1), v2: Number(p.v2) } : null;
      })
      .filter((p): p is { index: number; v1: number; v2: number } => p != null);
  }

  // ---- Client-side calc computed signals (existing, refactored to use helper) ----

  // Category-indexed HT Trendline data (client-side calc)
  readonly categoryHtTrendline = computed(() => this.mapToCategoryIndex(this.store.htTrendlineData()));

  // Category-indexed HT Sine data (client-side calc)
  readonly categoryHtSine = computed(() => this.mapToCategoryIndex(this.store.htSineData()));

  // Category-indexed HT Lead Sine data (client-side calc)
  readonly categoryHtLeadSine = computed(() => this.mapToCategoryIndex(this.store.htLeadSineData()));

  // ---- Endpoint indicator computed signals (Task #26) ----

  // HT_TRENDLINE endpoint — single series, overlaid on price chart
  readonly categoryHtTrendlineEndpoint = computed(() => this.mapToCategoryIndex(this.store.htTrendline().data));

  // HT_DCPERIOD endpoint — single series, lower pane
  readonly categoryHtDcperiod = computed(() => this.mapToCategoryIndex(this.store.htDcperiod().data));

  // HT_DCPHASE endpoint — single series, lower pane
  readonly categoryHtDcphase = computed(() => this.mapToCategoryIndex(this.store.htDcphase().data));

  // HT_TRENDMODE endpoint — single series (0/1 values), lower pane ~50px
  readonly categoryHtTrendmode = computed(() => this.mapToCategoryIndex(this.store.htTrendmode().data));

  // HT_SINE endpoint — dual series (sine + lead_sine), overlay or lower pane
  readonly categoryHtSineEndpoint = computed(() => this.mapDualToCategoryIndex(this.store.htSine().dualData ?? []));

  // HT_PHASOR endpoint — dual series (in-phase + quadrature), lower pane
  readonly categoryHtPhasor = computed(() => this.mapDualToCategoryIndex(this.store.htPhasor().dualData ?? []));

  constructor() {

    // apply initial zoom + Y viewport. This fires whenever the store's
    // chartData signal changes, so it handles symbol switches that don't
    // trigger a (loaded) event (since the chart isn't destroyed/recreated).
    effect(() => {
      const data = this.store.chartData();
      if (!data || data.length === 0) return;

      // Defer to next tick so the chart has time to bind the new dataSource
      setTimeout(() => {
        this.applyInitialZoom(data);
      });
    });

    // Effect (B): THE Y-AXIS VIEWPORT EFFECT — single place that writes
    // min/max to the chart instance and calls dataBind().
    effect(() => {
      const viewport = this.yAxisViewport();
      const chart = this.chart;
      const _ = this.primaryYAxis(); // keep dependency on axis config
      if (!chart || !viewport) return;

      // Write directly to the chart instance — NOT to the bound primaryYAxis object.
      (chart as any).primaryYAxis.minimum = viewport.min;
      (chart as any).primaryYAxis.maximum = viewport.max;

      // Also update the secondary price axis
      const secondaryAxis = (chart as any).axes?.find((a: any) => a.name === 'SecondaryYAxis');
      if (secondaryAxis) {
        secondaryAxis.minimum = viewport.min;
        secondaryAxis.maximum = viewport.max;
      }

      chart.animateSeries = false;
      chart.dataBind();
    });

    // Effect (C): Rebind chart when indicator data arrives asynchronously.
    // Syncfusion doesn't pick up [dataSource] updates on existing series when
    // async data arrives after the initial render. dataBind() forces it to
    // re-read the series dataSource arrays.
    effect(() => {
      // Track all indicator data signals
      const _ = [
        this.store.htTrendline().data,
        this.store.htSine().dualData,
        this.store.htDcperiod().data,
        this.store.htDcphase().data,
        this.store.htTrendmode().data,
        this.store.htPhasor().dualData,
      ];
      const chart = this.chart;
      if (!chart) return;
      chart.animateSeries = false;
      try { chart.dataBind(); } catch { /* suppress Syncfusion race */ }
    });

    // Effect (D): Watch indicator states for errors and show a toast when one appears.
    // Uses a tracked-set to avoid re-showing the same error on unrelated signal triggers.
    // Errors are removed from the set when they clear (indicator toggled off or new fetch
    // succeeds), so the same error can be re-shown if it re-occurs later.
    const shownErrors = new Set<string>();
    effect(() => {
      const currentErrors = new Set<string>();
      for (const toggle of this.indicatorToggles()) {
        const err = toggle.state.error;
        if (err) {
          currentErrors.add(err);
          if (!shownErrors.has(err)) {
            shownErrors.add(err);
            this.showIndicatorError(err);
          }
        }
      }
      // Remove errors that are no longer active — prevents unbounded growth
      for (const shown of shownErrors) {
        if (!currentErrors.has(shown)) {
          shownErrors.delete(shown);
        }
      }
    });
  }

  // Chart Configuration
  // Category X-axis: uses integer indices, no date gaps for weekends/holidays.
  // Labels are formatted via the axisLabelRender callback to show dates.
  // No striplines (they cause rendering bugs on Category axes). Year separators
  // are not rendered.
  readonly primaryXAxis = computed<Object>(() => {
    // Re-evaluate when the dataset changes so Syncfusion rebuilds the axis
    this.store.chartData().length;

    return {
      valueType: 'Category',
      majorGridLines: { width: 0 },
      edgeLabelPlacement: 'Shift',
    };
  });
  readonly primaryYAxis = computed(() => ({
    title: 'Price',
    rowIndex: ChartViewComponent.PRICE_ROW_INDEX,
    majorGridLines: { width: 1 },
    lineStyle: { width: 0 },
    labelFormat: '${value}',
    rangePadding: 'None',
    labelStyle: { fontFamily: 'Roboto, "Helvetica Neue", sans-serif' },
    titleStyle: { fontFamily: 'Roboto, "Helvetica Neue", sans-serif' },
    crosshairTooltip: { enable: true },
    enableAutoIntervalOnZooming: true
  }));

  // Base axis definitions for the price chart (always present)
  private readonly secondaryYAxisDef = {
    name: 'SecondaryYAxis',
    opposedPosition: true,
    majorGridLines: { width: 0 },
    majorTickLines: { width: 1 },
    lineStyle: { width: 1 },
    labelFormat: '${value}',
    rangePadding: 'None',
    labelStyle: { fontFamily: 'Roboto, "Helvetica Neue", sans-serif' },
    titleStyle: { fontFamily: 'Roboto, "Helvetica Neue", sans-serif' },
    enableAutoIntervalOnZooming: true
  };

  private readonly sineOverlayAxisDef = {
    name: 'SineAxis',
    opposedPosition: true,
    minimum: -1,
    maximum: 1,
    interval: 0.5,
    majorGridLines: { width: 0 },
    majorTickLines: { width: 1 },
    lineStyle: { width: 1 },
    labelFormat: '{value}',
    rangePadding: 'None',
    labelStyle: { fontFamily: 'Roboto, "Helvetica Neue", sans-serif', size: '10px' },
    titleStyle: { fontFamily: 'Roboto, "Helvetica Neue", sans-serif' },
    title: 'Sine'
  };

  // ---- Fixed-pane rows + axes (Task #26: multi-pane layout) ----
  // Always emit a FIXED set of lower pane slots so the row/axis structure
  // never changes on toggle. Inactive panes get 0% height and hidden grid
  // lines. This avoids Syncfusion's expensive
  // full-chart reinit (3-5s delay + broken rendering) when rows/axes change.

  /** Single source of truth for lower-pane configuration.
   *  Order is bottom-to-top (rowIndex 0..4). Price chart is at rowIndex 5. */
  private static sinePaneActive(s: InstanceType<typeof ChartViewStore>): boolean {
    return s.htSine().show && (s.sineDisplayMode() === 'pane' || s.sineDisplayMode() === 'both');
  }

  private static readonly PANE_CONFIG = [
    { name: 'DcphaseAxis',   rowIndex: 0, title: 'DC Phase',   compact: false, paneActive: (s: InstanceType<typeof ChartViewStore>) => s.htDcphase().show },
    { name: 'DcperiodAxis',  rowIndex: 1, title: 'DC Period',  compact: false, paneActive: (s: InstanceType<typeof ChartViewStore>) => s.htDcperiod().show },
    { name: 'SinePaneAxis',  rowIndex: 2, title: 'Sine',       compact: false, paneActive: ChartViewComponent.sinePaneActive, min: -1, max: 1, interval: 0.5 },
    { name: 'TrendmodeAxis', rowIndex: 3, title: 'Trend Mode', compact: true,  paneActive: (s: InstanceType<typeof ChartViewStore>) => s.htTrendmode().show, min: 0, max: 1, interval: 1 },
    { name: 'PhasorAxis',    rowIndex: 4, title: 'Phasor',     compact: false, paneActive: (s: InstanceType<typeof ChartViewStore>) => s.htPhasor().show },
  ] as const;

  private static readonly PRICE_ROW_INDEX = ChartViewComponent.PANE_CONFIG.length;

  /** Fixed row definitions — 5 lower panes (0% when inactive) + price chart at top.
   *  Syncfusion rows render bottom-to-top: rows[0] is bottom, rows[N-1] is top. */
  readonly chartRows = computed<Object[]>(() => {
    const s = this.store;
    const panes = ChartViewComponent.PANE_CONFIG;
    const lowerHalf = 50;
    const compactWeight = 0.4;

    // Single-pass: compute heights and accumulate lower total
    let lowerTotal = 0;
    const activeCounts = panes.reduce(
      (acc, p) => {
        const isActive = p.paneActive(s);
        if (isActive) {
          acc.normal += p.compact ? 0 : 1;
          acc.compact += p.compact ? 1 : 0;
        }
        return acc;
      },
      { normal: 0, compact: 0 },
    );

    const totalUnits = activeCounts.normal + activeCounts.compact * compactWeight;
    const normalH = totalUnits > 0 ? (lowerHalf / totalUnits) : 0;
    const compactH = normalH * compactWeight;

    const rows = panes.map(p => {
      const isActive = p.paneActive(s);
      const h = !isActive ? 0 : (p.compact ? compactH : normalH);
      if (isActive) lowerTotal += h;
      return { height: `${h.toFixed(1)}%` };
    });
    rows.push({ height: `${(100 - lowerTotal).toFixed(1)}%` }); // price chart at the top
    return rows;
  });

  /** Fixed axes — always emits all 5 lower-pane axes + price axes.
   *  Inactive panes get hidden grid lines and empty label format. */
  readonly chartAxes = computed<Object[]>(() => {
    const s = this.store;
    const priceRow = ChartViewComponent.PRICE_ROW_INDEX;
    const axes: Object[] = [{ ...this.secondaryYAxisDef, rowIndex: priceRow }];

    // SineAxis (overlay) — present only for endpoint HT_SINE overlay/both mode.
    // Local HT Calc sine/lead-sine are rendered in the Sine lower pane instead.
    if (this.sineOverlayActive()) axes.push({ ...this.sineOverlayAxisDef, rowIndex: priceRow });

    // Lower-pane axes — derived from PANE_CONFIG (single source of truth)
    for (const cfg of ChartViewComponent.PANE_CONFIG) {
      const isActive = cfg.paneActive(s);
      axes.push({
        name: cfg.name,
        valueType: 'Double',
        rowIndex: cfg.rowIndex,
        opposedPosition: true,
        ...('min' in cfg ? { minimum: cfg.min } : {}),
        ...('max' in cfg ? { maximum: cfg.max } : {}),
        ...('interval' in cfg ? { interval: cfg.interval } : {}),
        majorGridLines: { width: 0, color: 'rgba(158,158,158,0.3)' },
        majorTickLines: { width: isActive ? 1 : 0 },
        lineStyle: { width: isActive ? 1 : 0, color: '#9e9e9e' },
        labelFormat: isActive ? '{value}' : '',
        rangePadding: 'None',
        crosshairTooltip: { enable: false },
        labelStyle: { fontFamily: 'Roboto, "Helvetica Neue", sans-serif', size: '10px' },
        title: isActive ? cfg.title : ''
      });
    }
    return axes;
  });

  public zoomSettings: ZoomSettingsModel = {
    enableMouseWheelZooming: true,
    enablePinchZooming: true,
    enableSelectionZooming: true,
    enablePan: true,
    enableScrollbar: true,
    toolbarItems: ['Zoom', 'ZoomIn', 'ZoomOut', 'Pan', 'Reset'],
    mode: 'X',
    toolbarPosition: {
      horizontalAlignment: 'Near',
      verticalAlignment: 'Top'
    }
  };
  public title: string = 'Stock Price History';
  public titleStyle: Object = {
    fontFamily: 'Roboto, "Helvetica Neue", sans-serif',
    size: '16px',
    fontWeight: '500'
  };
  public tooltipSettings: Object = {
    enable: true,
    shared: true,
    format: '${series.name}: ${point.high} - ${point.low}'
  };

  public crosshairSettings: Object = {
    enable: true,
    lineType: 'Both',
    snapToData: true,
    line: { color: '#757575', width: 1 }
  };

  ngOnInit(): void {
    this.store.loadSymbols();
    if (!this.store.selectedSymbol()) {
      this.onSymbolSelected('AAPL');
    }
  }

  private clearPersistedZoom(): void {
    this.store.setZoomSettings(null, null);
  }

  onSymbolSelected(symbol: string): void {
    this.title = `${symbol} Stock Price History`;
    this.clearPersistedZoom();
    this.store.selectSymbol(symbol);
    this.isInitialLoad = true;
  }

  onSplitAdjustedChange(checked: boolean): void {
    this.store.setSplitAdjusted(checked);
    this.isInitialLoad = true;
  }

  onIntervalChange(interval: TimeSeriesInterval): void {
    this.clearPersistedZoom();
    this.store.setInterval(interval);
    this.isInitialLoad = true;
  }

  onLocalHtCalcToggle(): void {
    this.store.toggleLocalHtCalc();
    this.refreshChartAfterToggle();
  }

  onIndicatorToggle(key: HtIndicator): void {
    this.store.toggleIndicator(key);
    this.refreshChartAfterToggle();
  }

  onSeriesTypeChange(seriesType: PriceSeries): void {
    this.store.setIndicatorSeriesType(seriesType);
    this.refreshChartAfterToggle();
  }

  onSineDisplayModeChange(mode: SineDisplayMode): void {
    this.store.setSineDisplayMode(mode);
    this.refreshChartAfterToggle();
  }

  private showIndicatorError(message: string): void {
    this.snackBar.open(`Indicator error: ${message}`, 'Dismiss', {
      duration: 5000,
      panelClass: ['indicator-error-toast'],
    });
  }

  private refreshChartAfterToggle(): void {
    setTimeout(() => {
      if (!this.chart) return;
      this.chart.animateSeries = false;
      this.chart.dataBind();
      this.chart.refresh();
    });
  }

  viewAll(): void {
    if (this.chart && this.chart.primaryXAxis) {
        this.chart.primaryXAxis.zoomFactor = 1;
        this.chart.primaryXAxis.zoomPosition = 0;
        this.store.setZoomSettings(1, 0);
        this.computeAndSetViewport(this.store.chartData(), 1, 0);
    }
  }

  /**
   * Applies initial X-axis zoom and Y-axis viewport for the current dataset.
   * Called from effect (A) when chartData changes. Year striplines were removed
   * (they cause rendering bugs on Category axes); date labels are shown via
   * the axisLabelRender callback instead.
   */
  private applyInitialZoom(data: any[]): void {
    if (!this.chart || !data || data.length === 0) return;

    // 1. Determine zoom factor/position (persisted or default)
    const savedFactor = this.store.zoomFactor();
    const savedPosition = this.store.zoomPosition();

    let zoomFactor: number;
    let zoomPosition: number;

    if (savedFactor !== null && savedPosition !== null) {
        zoomFactor = savedFactor;
        zoomPosition = savedPosition;
    } else {
        let initialPoints = 90;
        switch (this.store.selectedInterval()) {
            case TimeSeriesInterval.WEEKLY:
                initialPoints = 52;
                break;
            case TimeSeriesInterval.MONTHLY:
                initialPoints = 36;
                break;
            case TimeSeriesInterval.DAILY:
            default:
                initialPoints = 90;
                break;
        }

        if (data.length > initialPoints) {
            zoomFactor = initialPoints / data.length;
            zoomPosition = (data.length - initialPoints) / data.length;
        } else {
            zoomFactor = 1;
            zoomPosition = 0;
        }
        this.store.setZoomSettings(zoomFactor, zoomPosition);
    }

    // 2. Set X zoom, then set viewport signal (triggers effect B)
    this.chart.primaryXAxis.zoomFactor = zoomFactor;
    this.chart.primaryXAxis.zoomPosition = zoomPosition;
    this.computeAndSetViewport(data, zoomFactor, zoomPosition);
  }

  onScrollEnd(event: IScrollEventArgs): void {
      this.updateZoomState();
      const data = this.store.chartData();
      if (data.length > 0 && this.chart?.primaryXAxis) {
        const zf = this.chart.primaryXAxis.zoomFactor ?? 1;
        const zp = this.chart.primaryXAxis.zoomPosition ?? 0;
        this.computeAndSetViewport(data, zf, zp);
      }
  }

  private updateZoomState(): void {
      if (this.chart && this.chart.primaryXAxis) {
          this.store.setZoomSettings(
              this.chart.primaryXAxis.zoomFactor || 1,
              this.chart.primaryXAxis.zoomPosition || 0
          );
      }
  }

  onZoomComplete(args: IZoomCompleteEventArgs): void {
    if (args.axis.name === 'primaryXAxis') {
      this.store.setZoomSettings(args.currentZoomFactor, args.currentZoomPosition);
      const data = this.store.chartData();
      if (data.length > 0) {
        this.computeAndSetViewport(data, args.currentZoomFactor, args.currentZoomPosition);
      }
    }
  }

  /**
   * Replaces Category axis integer labels (0, 1, 2...) with formatted date strings.
   * Syncfusion Category axis uses the xName field as the label, which is an integer
   * index. We look up the actual date from chartData and format it.
   */
  axisLabelRender(args: IAxisLabelRenderEventArgs): void {
    // Ensure text is always a string — Syncfusion's crosshair tooltip calls
    // text.indexOf() which crashes if text is a number or undefined.
    if (args.axis.name === 'primaryXAxis') {
      const idx = Number(args.text);
      if (!isNaN(idx)) {
        const data = this.store.chartData();
        if (idx >= 0 && idx < data.length) {
          const d = new Date(data[idx].t);
          args.text = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          return;
        }
      }
    }
    // For all other axes, coerce text to string to prevent crosshair crash
    if (args.text != null && typeof args.text !== 'string') {
      args.text = String(args.text);
    }
  }

  /**
   * Computes the visible bar slice and sets the yAxisViewport signal.
   */
  private computeAndSetViewport(data: any[], zoomFactor: number, zoomPosition: number): void {
    if (!data || data.length === 0) return;

    const visibleCount = Math.max(1, Math.ceil(data.length * zoomFactor));
    const startIdx = Math.floor(data.length * zoomPosition);
    const endIdx = Math.min(data.length, startIdx + visibleCount);

    const visibleData = data.slice(startIdx, endIdx);
    if (visibleData.length === 0) return;

    // Filter out null/undefined/NaN/0 values — Number(null) returns 0, which
    // would drag the min down to 0 and produce the full-range Y-axis bug.
    const lows = visibleData.map((d: any) => d.l).filter((v: number) => v != null && !isNaN(v) && v > 0);
    const highs = visibleData.map((d: any) => d.h).filter((v: number) => v != null && !isNaN(v) && v > 0);
    if (lows.length === 0 || highs.length === 0) return;

    let min = Math.min(...lows);
    let max = Math.max(...highs);
    const range = max - min;
    const padding = range === 0 ? 1 : range * 0.03;
    min -= padding;
    max += padding;

    this.yAxisViewport.set({ min, max });
  }

  /**
   * Creates a stable string key from a date for index matching.
   * Uses the date's time value to handle Date object equality.
   */
  private dateKey(d: Date): string {
    return new Date(d).getTime().toString();
  }
}

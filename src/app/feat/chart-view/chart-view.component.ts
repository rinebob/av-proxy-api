import { Component, OnInit, inject, ViewChild, effect, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { FormsModule } from '@angular/forms';
import { ChartModule, ChartComponent, CandleSeriesService, LineSeriesService, CategoryService, TooltipService, ZoomService, CrosshairService, ZoomSettingsModel, IZoomCompleteEventArgs, IScrollEventArgs, ScrollBarService, StripLineService, StripLineSettingsModel, ITooltipRenderEventArgs, IAxisLabelRenderEventArgs } from '@syncfusion/ej2-angular-charts';
import { ChartViewStore } from './store/chart-view.store';
import { TimeSeriesInterval } from '@shared/alpha-vantage';

interface YAxisViewport {
  min: number;
  max: number;
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
    FormsModule,
    ChartModule
  ],
  providers: [
    ChartViewStore,
    CandleSeriesService,
    LineSeriesService,
    CategoryService,
    TooltipService,
    ZoomService,
    CrosshairService,
    ScrollBarService,
    StripLineService
  ],
  templateUrl: './chart-view.component.html',
  styleUrls: ['./chart-view.component.scss']
})
export class ChartViewComponent implements OnInit {
  @ViewChild('chart') chart!: ChartComponent;
  readonly store = inject(ChartViewStore);
  readonly currentYear = new Date().getFullYear();
  readonly TimeSeriesInterval = TimeSeriesInterval;

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

  // Category-indexed HT Trendline data
  readonly categoryHtTrendline = computed(() => {
    const htData = this.store.htTrendlineData();
    const bars = this.store.chartData();
    if (htData.length === 0 || bars.length === 0) return [];
    // htTrendlineData points have { t, v } — map to index by matching dates
    const dateToIndex = new Map<string, number>();
    bars.forEach((b: any, i: number) => {
      dateToIndex.set(this.dateKey(b.t), i);
    });
    return htData
      .map((p: any) => {
        const idx = dateToIndex.get(this.dateKey(p.t));
        return idx != null ? { index: idx, v: p.v } : null;
      })
      .filter((p: any) => p != null);
  });

  // Category-indexed HT Sine data
  readonly categoryHtSine = computed(() => {
    const htData = this.store.htSineData();
    const bars = this.store.chartData();
    if (htData.length === 0 || bars.length === 0) return [];
    const dateToIndex = new Map<string, number>();
    bars.forEach((b: any, i: number) => {
      dateToIndex.set(this.dateKey(b.t), i);
    });
    return htData
      .map((p: any) => {
        const idx = dateToIndex.get(this.dateKey(p.t));
        return idx != null ? { index: idx, v: p.v } : null;
      })
      .filter((p: any) => p != null);
  });

  // Category-indexed HT Lead Sine data
  readonly categoryHtLeadSine = computed(() => {
    const htData = this.store.htLeadSineData();
    const bars = this.store.chartData();
    if (htData.length === 0 || bars.length === 0) return [];
    const dateToIndex = new Map<string, number>();
    bars.forEach((b: any, i: number) => {
      dateToIndex.set(this.dateKey(b.t), i);
    });
    return htData
      .map((p: any) => {
        const idx = dateToIndex.get(this.dateKey(p.t));
        return idx != null ? { index: idx, v: p.v } : null;
      })
      .filter((p: any) => p != null);
  });

  constructor() {
    // Effect (A): When chartData changes (new symbol, interval, etc.),
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
  }

  // Chart Configuration
  // Category X-axis: uses integer indices, no date gaps for weekends/holidays.
  // Labels are formatted via the labelFormat callback to show dates.
  public primaryXAxis: Object = {
    valueType: 'Category',
    crosshairTooltip: { enable: true },
    majorGridLines: { width: 0 },
    labelPlacement: 'OnTicks',
    labelStyle: { fontFamily: 'Roboto, "Helvetica Neue", sans-serif' },
    // Custom label format: show the date for each category index.
    // Syncfusion Category axis supports a labelFormat function via 'skeleton'/'format'
    // but the simplest approach is to set the category label to a date string
    // in the data itself (xName points to a formatted string). We use the
    // 'dateLabel' field in categoryBars for this.
    intervalType: 'Auto',
    edgeLabelPlacement: 'Shift'
  };
  public primaryYAxis: Object = {
    title: 'Price',
    majorGridLines: { width: 1 },
    lineStyle: { width: 0 },
    labelFormat: '${value}',
    rangePadding: 'None',
    labelStyle: { fontFamily: 'Roboto, "Helvetica Neue", sans-serif' },
    titleStyle: { fontFamily: 'Roboto, "Helvetica Neue", sans-serif' },
    crosshairTooltip: { enable: true },
    enableAutoIntervalOnZooming: true
  };

  public axes: Object[] = [{
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
  },
  {
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
  }];

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

  onHtTrendlineToggle(checked: boolean): void {
    this.store.toggleHtTrendline();
    this.refreshChartAfterToggle();
  }

  onHtSineToggle(checked: boolean): void {
    this.store.toggleHtSine();
    this.refreshChartAfterToggle();
  }

  private refreshChartAfterToggle(): void {
    setTimeout(() => {
      if (!this.chart) return;
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

  onChartLoaded(): void {
    // The initial load is handled by effect (A) which watches chartData().
    // This handler is kept for Syncfusion's (loaded) event but the real
    // work happens in applyInitialZoom(), called from the effect.
  }

  /**
   * Applies initial X-axis zoom, striplines, and Y-axis viewport for the
   * current dataset. Called from effect (A) when chartData changes and
   * from onChartLoaded as a fallback.
   */
  private applyInitialZoom(data: any[]): void {
    if (!this.chart || !data || data.length === 0) return;

    // 1. Generate year striplines at the category index of the first bar of each year.
    if (this.chart.primaryXAxis) {
        const stripLines: StripLineSettingsModel[] = [];
        const seenYears = new Set<number>();

        for (let i = 0; i < data.length; i++) {
          const d = new Date(data[i].t);
          const year = d.getFullYear();
          if (!seenYears.has(year)) {
            seenYears.add(year);
            stripLines.push({
                start: i,
                size: 1,
                sizeType: 'Pixel',
                color: '#7a7a7a',
                dashArray: '3,3',
                text: year.toString(),
                textStyle: {
                    color: '#7a7a7a',
                    size: '12px',
                    fontWeight: 'bold',
                    fontFamily: 'Roboto, "Helvetica Neue", sans-serif'
                },
                verticalAlignment: 'Start',
                horizontalAlignment: 'Middle'
            });
          }
        }
        this.chart.primaryXAxis.stripLines = stripLines;
    }

    // 2. Determine zoom factor/position (persisted or default)
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

    // 3. Set X zoom, then set viewport signal (triggers effect B)
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

  tooltipRender(args: ITooltipRenderEventArgs): void {
  }

  /**
   * Replaces Category axis integer labels (0, 1, 2...) with formatted date strings.
   * Syncfusion Category axis uses the xName field as the label, which is an integer
   * index. We look up the actual date from chartData and format it.
   */
  axisLabelRender(args: IAxisLabelRenderEventArgs): void {
    if (args.axis.name !== 'primaryXAxis') return;
    const idx = Number(args.text);
    if (isNaN(idx)) return;
    const data = this.store.chartData();
    if (idx < 0 || idx >= data.length) return;
    const d = new Date(data[idx].t);
    args.text = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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

import { Component, OnInit, inject, ViewChild, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { FormsModule } from '@angular/forms';
import { ChartModule, ChartComponent, CandleSeriesService, DateTimeService, TooltipService, ZoomService, CrosshairService, ZoomSettingsModel, IZoomCompleteEventArgs, IScrollEventArgs, ScrollBarService, StripLineService, StripLineSettingsModel, ITooltipRenderEventArgs } from '@syncfusion/ej2-angular-charts';
import { ChartViewStore } from './store/chart-view.store';
import { TimeSeriesInterval } from '@shared/alpha-vantage';

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
    DateTimeService,
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

  // UI State for Zoom Mode
  isPanMode = true;

  constructor() {
    effect(() => {
      // Re-trigger initial load logic when data changes
      if (this.store.chartData().length > 0) {
        this.isInitialLoad = true;
      }
    });
  }

  // Chart Configuration
  public primaryXAxis: Object = {
    valueType: 'DateTime',
    crosshairTooltip: { enable: true },
    majorGridLines: { width: 0 },
    rangePadding: 'Additional', // Adds horizontal padding
    labelStyle: { fontFamily: 'Roboto, "Helvetica Neue", sans-serif' },
    labelFormat: 'MMM d, yyyy',
    intervalType: 'Auto'
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
  
  // Secondary Y-axis (Right side)
  public axes: Object[] = [{
    name: 'SecondaryYAxis',
    opposedPosition: true,
    majorGridLines: { width: 0 },
    majorTickLines: { width: 1 }, // Ensure ticks are visible
    lineStyle: { width: 1 }, // Ensure axis line is visible
    labelFormat: '${value}',
    rangePadding: 'None',
    labelStyle: { fontFamily: 'Roboto, "Helvetica Neue", sans-serif' },
    titleStyle: { fontFamily: 'Roboto, "Helvetica Neue", sans-serif' },
    enableAutoIntervalOnZooming: true
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
    
    // Set default symbol
    if (!this.store.selectedSymbol()) {
      this.onSymbolSelected('AAPL');
    }
  }

  onSymbolSelected(symbol: string): void {
    this.title = `${symbol} Stock Price History`;
    this.store.selectSymbol(symbol);
    this.isInitialLoad = true;
  }

  onSplitAdjustedChange(checked: boolean): void {
    this.store.setSplitAdjusted(checked);
    this.isInitialLoad = true;
  }

  onIntervalChange(interval: TimeSeriesInterval): void {
    this.store.setInterval(interval);
    this.isInitialLoad = true;
  }

  viewAll(): void {
    if (this.chart && this.chart.primaryXAxis) {
        this.chart.primaryXAxis.zoomFactor = 1;
        this.chart.primaryXAxis.zoomPosition = 0;
        this.store.setZoomSettings(1, 0);
        this.chart.dataBind();
        this.rescaleYAxis();
    }
  }

  onChartLoaded(): void {
    if (!this.isInitialLoad || !this.chart) return;
    
    // Prevent recursion: set flag immediately
    this.isInitialLoad = false;

    const data = this.store.chartData();
    if (!data || data.length === 0) return;

    // 1. Clamp X-axis to data window with padding (match RS logic)
    // This ensures the scrollbar matches the data range
    const firstX = new Date(data[0].t);
    const lastX = new Date(data[data.length - 1].t);
    
    if (this.chart.primaryXAxis) {
        // Add 3 days padding to the right
        const paddingMs = 3 * 24 * 60 * 60 * 1000; 
        const paddedMax = new Date(lastX.getTime() + paddingMs);
        
        // We set these directly on the chart instance to define bounds
        this.chart.primaryXAxis.minimum = firstX;
        this.chart.primaryXAxis.maximum = paddedMax;

        // Generate Year Striplines
        const startYear = firstX.getFullYear();
        const endYear = lastX.getFullYear();
        const stripLines: StripLineSettingsModel[] = [];

        for (let year = startYear; year <= endYear + 1; year++) {
             // Create a stripline for Jan 1st of each year
             const yearStart = new Date(year, 0, 1);
             if (yearStart >= firstX && yearStart <= paddedMax) {
                 stripLines.push({
                     start: yearStart,
                     size: 1,
                     sizeType: 'Pixel',
                     color: '#7a7a7a', // Visible grey
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

    // 2. Check for persisted settings first
    const savedFactor = this.store.zoomFactor();
    const savedPosition = this.store.zoomPosition();

    if (savedFactor !== null && savedPosition !== null) {
         // Apply persisted settings
         setTimeout(() => {
             if (this.chart && this.chart.primaryXAxis) {
                 this.chart.primaryXAxis.zoomFactor = savedFactor;
                 this.chart.primaryXAxis.zoomPosition = savedPosition;
                 this.chart.dataBind();
                 this.rescaleYAxis();
             }
         });
         return;
    }

    // 3. Default initial zoom based on interval if no persistence
    let initialPoints = 252; // Default for Daily (approx 1 year)
    
    switch (this.store.selectedInterval()) {
        case TimeSeriesInterval.WEEKLY:
            initialPoints = 104; // Approx 2 years
            break;
        case TimeSeriesInterval.MONTHLY:
            initialPoints = 60; // Approx 5 years
            break;
        case TimeSeriesInterval.DAILY:
        default:
            initialPoints = 252;
            break;
    }
    
    setTimeout(() => {
        if (this.chart && this.chart.primaryXAxis) {
            if (data.length > initialPoints) {
                const zoomFactor = initialPoints / data.length;
                const zoomPosition = (data.length - initialPoints) / data.length;

                this.chart.primaryXAxis.zoomFactor = zoomFactor;
                this.chart.primaryXAxis.zoomPosition = zoomPosition;

                // Store these defaults so they persist if user switches immediately
                this.store.setZoomSettings(zoomFactor, zoomPosition);
            } else {
                // Fallback if no zoom needed
                this.store.setZoomSettings(1, 0);
            }
            this.chart.dataBind();
            this.rescaleYAxis();
        }
    });
  }

  onScrollEnd(event: IScrollEventArgs): void {
      this.updateZoomState();
      this.rescaleYAxis();
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
      this.rescaleYAxis();
    }
  }

  tooltipRender(args: ITooltipRenderEventArgs): void {
    console.log('Tooltip Render:', args);
    console.log('Point Data:', args.point);
    console.log('Series Name:', args.series.name);
    console.log('Text:', args.text);
    
    // Log the date specifically
    const point = args.point as any;
    if (point && point.x) {
        console.log('Tooltip Date (X):', point.x);
        console.log('Tooltip X Value (Time):', point.x.getTime ? point.x.getTime() : point.x);
    }
  }

  /**
   * Rescales the Y-axis based on the chart's actual visible X-range so it fits
   * the candles currently on screen rather than the full history.
   */
  private rescaleYAxis(): void {
    if (!this.chart || !this.chart.primaryXAxis) return;

    const xAxis = this.chart.primaryXAxis as any;
    const visibleRange = xAxis.visibleRange;
    if (!visibleRange || visibleRange.min == null || visibleRange.max == null) return;

    const minTime = typeof visibleRange.min === 'number'
      ? visibleRange.min
      : new Date(visibleRange.min).getTime();
    const maxTime = typeof visibleRange.max === 'number'
      ? visibleRange.max
      : new Date(visibleRange.max).getTime();

    const visibleData = this.store.chartData().filter((d: any) => {
      const t = d.t instanceof Date ? d.t.getTime() : new Date(d.t).getTime();
      return t >= minTime && t <= maxTime;
    });

    if (visibleData.length > 0) {
      this.updateYAxisRange(visibleData);
    }
  }

  private updateYAxisRange(visibleData: any[]): void {
    const validLows = visibleData.map((d: any) => d.l).filter((l: number) => l != null && !isNaN(l));
    const validHighs = visibleData.map((d: any) => d.h).filter((h: number) => h != null && !isNaN(h));

    if (validLows.length === 0 || validHighs.length === 0) return;

    let min = Math.min(...validLows);
    let max = Math.max(...validHighs);
    const range = max - min;
    const padding = range === 0 ? 1 : range * 0.02;
    min -= padding;
    max += padding;

    const yAxis = { ...this.primaryYAxis, minimum: min, maximum: max };
    delete (yAxis as any).interval;

    this.chart.primaryYAxis = yAxis;

    const secondaryAxis = this.chart.axes.find(a => (a as any).name === 'SecondaryYAxis');
    if (secondaryAxis) {
      secondaryAxis.minimum = min;
      secondaryAxis.maximum = max;
      delete (secondaryAxis as any).interval;
    }

    this.primaryYAxis = yAxis;
    this.axes = this.axes.map(a => {
      if ((a as any).name === 'SecondaryYAxis') {
        const axis = { ...a, minimum: min, maximum: max };
        delete (axis as any).interval;
        return axis;
      }
      return a;
    });

    this.chart.dataBind();
  }
}

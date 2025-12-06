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
import { ChartModule, ChartComponent, CandleSeriesService, DateTimeService, TooltipService, ZoomService, CrosshairService, ZoomSettingsModel, IZoomCompleteEventArgs, IScrollEventArgs, ScrollBarService, StripLineService, StripLineSettingsModel } from '@syncfusion/ej2-angular-charts';
import { ChartViewStore } from './store/chart-view.store';

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
    titleStyle: { fontFamily: 'Roboto, "Helvetica Neue", sans-serif' }
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
    titleStyle: { fontFamily: 'Roboto, "Helvetica Neue", sans-serif' }
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

    // 2. Set initial zoom to most recent year (approx 252 trading days)
    let zoomFactor = 1;
    let zoomPosition = 0;
    
    const initialDays = 252;
    if (data.length > initialDays && this.chart.primaryXAxis) {
        zoomFactor = initialDays / data.length;
        zoomPosition = (data.length - initialDays) / data.length;

        this.chart.primaryXAxis.zoomFactor = zoomFactor;
        this.chart.primaryXAxis.zoomPosition = zoomPosition;
        
        // Update bound property to keep sync
        this.primaryXAxis = {
            ...this.primaryXAxis,
            zoomFactor: zoomFactor,
            zoomPosition: zoomPosition
        };
    }

    // 3. Initial Y-axis autoscale based on the new zoom
    this.rescaleYAxis(zoomFactor, zoomPosition);
  }

  onScrollEnd(event: IScrollEventArgs): void {
      this.handleScroll();
  }

  onScrollChanged(event: IScrollEventArgs): void {
      this.handleScroll();
  }

  private handleScroll(): void {
      if (this.chart && this.chart.primaryXAxis) {
          this.rescaleYAxis(
              this.chart.primaryXAxis.zoomFactor || 1, 
              this.chart.primaryXAxis.zoomPosition || 0
          );
      }
  }

  onZoomComplete(args: IZoomCompleteEventArgs): void {
    if (args.axis.name === 'primaryXAxis') {
      this.rescaleYAxis(args.currentZoomFactor, args.currentZoomPosition);
    }
  }

  /**
   * Rescales the Y-axis based on the visible data range.
   * @param zoomFactor Current zoom factor (0 to 1)
   * @param zoomPosition Current zoom position (0 to 1)
   */
  private rescaleYAxis(zoomFactor: number, zoomPosition: number): void {
      const currentData = this.store.chartData();
      if (!currentData || currentData.length === 0) return;

      // Calculate visible range indices based on zoom factor and position
      const totalPoints = currentData.length;
      const startIndex = Math.floor(zoomPosition * totalPoints);
      const endIndex = Math.ceil((zoomPosition + zoomFactor) * totalPoints);
      
      const visibleData = currentData.slice(Math.max(0, startIndex), Math.min(totalPoints, endIndex));
      
      if (visibleData.length > 0) {
          this.updateYAxisRange(visibleData);
      }
  }

  private updateYAxisRange(visibleData: any[]): void {
    const lows = visibleData.map((d: any) => d.l);
    const highs = visibleData.map((d: any) => d.h);
    
    const validLows = lows.filter((l: number) => l != null && !isNaN(l));
    const validHighs = highs.filter((h: number) => h != null && !isNaN(h));

    if (validLows.length === 0 || validHighs.length === 0) return;

    const min = Math.min(...validLows);
    const max = Math.max(...validHighs);
    
    // Calculate nice range
    const { niceMin, niceMax, interval } = this.calculateNiceRange(min, max);

    this.chart.primaryYAxis.minimum = niceMin;
    this.chart.primaryYAxis.maximum = niceMax;
    this.chart.primaryYAxis.interval = interval;
    
    // Update Secondary Axis Instance
    const secondaryAxis = this.chart.axes.find(a => a.name === 'SecondaryYAxis');
    if (secondaryAxis) {
        secondaryAxis.minimum = niceMin;
        secondaryAxis.maximum = niceMax;
        secondaryAxis.interval = interval;
    }

    // Update Bound Properties to prevent reversion during Change Detection
    this.primaryYAxis = {
        ...this.primaryYAxis,
        minimum: niceMin,
        maximum: niceMax,
        interval: interval
    };

    this.axes = this.axes.map(a => {
        if ((a as any).name === 'SecondaryYAxis') {
            return { ...a, minimum: niceMin, maximum: niceMax, interval: interval };
        }
        return a;
    });

    this.chart.dataBind();
  }

  /**
   * Calculates a "nice" range for the axis with round number intervals.
   */
  private calculateNiceRange(min: number, max: number): { niceMin: number, niceMax: number, interval: number } {
      const range = max - min;
      if (range === 0) return { niceMin: min - 1, niceMax: max + 1, interval: 1 };

      // Target ~5-10 ticks
      const targetTicks = 8;
      const rawInterval = range / targetTicks;
      
      const magnitude = Math.pow(10, Math.floor(Math.log10(rawInterval)));
      const normalizedInterval = rawInterval / magnitude;
      
      let niceFraction;
      if (normalizedInterval < 1.5) niceFraction = 1;
      else if (normalizedInterval < 3) niceFraction = 2; // prefer 2 over 2.5 for cleaner integers if possible
      else if (normalizedInterval < 7) niceFraction = 5;
      else niceFraction = 10;
      
      const interval = niceFraction * magnitude;
      
      const niceMin = Math.floor(min / interval) * interval;
      const niceMax = Math.ceil(max / interval) * interval;
      
      return { niceMin, niceMax, interval };
  }
}

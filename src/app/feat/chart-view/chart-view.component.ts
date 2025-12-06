import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { FormsModule } from '@angular/forms';
import { ChartModule, CandleSeriesService, DateTimeService, TooltipService, ZoomService, CrosshairService, ZoomSettingsModel } from '@syncfusion/ej2-angular-charts';
import { ChartViewStore } from './store/chart-view.store';

@Component({
  selector: 'app-chart-view',
  standalone: true,
  imports: [
    CommonModule,
    MatFormFieldModule,
    MatSelectModule,
    MatSlideToggleModule,
    FormsModule,
    ChartModule
  ],
  providers: [
    ChartViewStore,
    CandleSeriesService,
    DateTimeService,
    TooltipService,
    ZoomService,
    CrosshairService
  ],
  templateUrl: './chart-view.component.html',
  styleUrls: ['./chart-view.component.scss']
})
export class ChartViewComponent implements OnInit {
  readonly store = inject(ChartViewStore);
  readonly currentYear = new Date().getFullYear();

  // Chart Configuration
  public primaryXAxis: Object = {
    valueType: 'DateTime',
    crosshairTooltip: { enable: true },
    majorGridLines: { width: 0 }
  };
  public primaryYAxis: Object = {
    title: 'Price',
    majorGridLines: { width: 1 },
    lineStyle: { width: 0 },
    labelFormat: '${value}',
    rangePadding: 'None' // This ensures the chart scales to fill the vertical space
  };
  public zoomSettings: ZoomSettingsModel = {
    enableMouseWheelZooming: true,
    enablePinchZooming: true,
    enableSelectionZooming: true,
    enablePan: true,
    mode: 'X'
  };
  public title: string = 'Stock Price History';

  ngOnInit(): void {
    this.store.loadSymbols();
  }

  onSymbolSelected(symbol: string): void {
    this.title = `${symbol} Stock Price History`;
    this.store.selectSymbol(symbol);
  }
}

import { Component, OnInit, inject } from '@angular/core';
import { CommonModule, JsonPipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatTabsModule } from '@angular/material/tabs';
import { MatListModule } from '@angular/material/list';
import { MatChipsModule } from '@angular/material/chips';
import { FirestoreDebugService } from '../../services/firestore-debug.service';
import { 
  TrackedSymbol, 
  EndpointData, 
  RefreshEvent 
} from '../../../data-maintainer-view/common/fe-common-dm-api';

@Component({
  selector: 'app-firestore-debug',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatExpansionModule,
    MatTabsModule,
    MatListModule,
    MatChipsModule,
    JsonPipe
  ],
  templateUrl: './firestore-debug.component.html',
  styleUrls: ['./firestore-debug.component.scss']
})
export class FirestoreDebugComponent implements OnInit {
  private debugService = inject(FirestoreDebugService);
  
  loading = true;
  trackedSymbols: TrackedSymbol[] = [];
  selectedSymbol: TrackedSymbol | null = null;
  // Store data points and refresh events by symbol and endpoint
  dataPoints: { [symbol: string]: { [endpoint: string]: EndpointData<any> } } = {};
  refreshEvents: { [symbol: string]: { [endpoint: string]: RefreshEvent } } = {};
  allSymbols: string[] = [];
  expandedPanels: {[key: string]: boolean} = {};
  selectedTabIndex = 0;
  testingWrite = false;
  marketDataStructure: any = null;

  ngOnInit() {
    this.loadTrackedSymbols();
    this.loadAllMarketData();
    this.loadMarketDataStructure();
  }

  loadTrackedSymbols() {
    this.loading = true;
    this.debugService.getTrackedSymbols().subscribe({
      next: (symbols) => {
        this.trackedSymbols = symbols;
        this.loading = false;
      },
      error: (error: Error) => {
        console.error('Error loading tracked symbols:', error);
        this.loading = false;
      }
    });
  }

  loadAllMarketData() {
    console.log('Loading all market data...');
    this.loading = true;
    this.debugService.getAllMarketData().subscribe({
      next: (symbols: string[]) => {
        console.log('Received market data symbols:', symbols);
        this.allSymbols = symbols;
        
        if (symbols.length === 0) {
          console.warn('No market data symbols found in the database');
          this.loading = false;
          return;
        }
        
        // Load data points and refresh events for each symbol
        symbols.forEach(symbol => {
          console.log(`Loading data for symbol: ${symbol}`);
          this.loadDataPoints(symbol);
          this.loadRefreshEvents(symbol);
        });
        
        this.loading = false;
      },
      error: (error: Error) => {
        console.error('Error loading market data:', error);
        this.loading = false;
      }
    });
  }

  loadDataPoints(symbol: string) {
    console.log(`Loading data points for symbol: ${symbol}`);
    this.debugService.getDataPoints(symbol).subscribe({
      next: (endpoints: string[]) => {
        console.log(`Found ${endpoints.length} data point endpoints for ${symbol}:`, endpoints);
        if (!this.dataPoints[symbol]) this.dataPoints[symbol] = {};
        
        if (endpoints.length === 0) {
          console.warn(`No data point endpoints found for symbol: ${symbol}`);
          return;
        }
        
        endpoints.forEach(endpoint => {
          console.log(`Loading data point for ${symbol} - ${endpoint}`);
          this.debugService.getDataPoint(symbol, endpoint).subscribe({
            next: (data) => {
              if (data) {
                console.log(`Successfully loaded data point for ${symbol} - ${endpoint}`);
                this.dataPoints[symbol][endpoint] = data;
              } else {
                console.warn(`No data returned for ${symbol} - ${endpoint}`);
              }
            },
            error: (err) => {
              console.error(`Error loading data point for ${symbol} - ${endpoint}:`, err);
            }
          });
        });
      },
      error: (error: Error) => {
        console.error(`Error loading data points for ${symbol}:`, error);
      }
    });
  }

  loadRefreshEvents(symbol: string) {
    console.log(`Loading refresh events for symbol: ${symbol}`);
    this.debugService.getRefreshEventEndpoints(symbol).subscribe({
      next: (endpoints: string[]) => {
        console.log(`Found ${endpoints.length} refresh event endpoints for ${symbol}:`, endpoints);
        if (!this.refreshEvents[symbol]) this.refreshEvents[symbol] = {};
        
        if (endpoints.length === 0) {
          console.warn(`No refresh event endpoints found for symbol: ${symbol}`);
          return;
        }
        
        endpoints.forEach(endpoint => {
          console.log(`Loading refresh event for ${symbol} - ${endpoint}`);
          this.debugService.getRefreshEvent(symbol, endpoint).subscribe({
            next: (event) => {
              if (event) {
                console.log(`Successfully loaded refresh event for ${symbol} - ${endpoint}`);
                this.refreshEvents[symbol][endpoint] = event;
              } else {
                console.warn(`No refresh event data returned for ${symbol} - ${endpoint}`);
              }
            },
            error: (err) => {
              console.error(`Error loading refresh event for ${symbol} - ${endpoint}:`, err);
            }
          });
        });
      },
      error: (error: Error) => {
        console.error(`Error loading refresh event endpoints for ${symbol}:`, error);
      }
    });
  }

  onSelectSymbol(symbol: TrackedSymbol) {
    this.selectedSymbol = symbol;
    this.loading = true;
    this.loadDataPoints(symbol.symbol);
    this.loadRefreshEvents(symbol.symbol);
    this.loading = false;
  }

  togglePanel(panel: string) {
    this.expandedPanels[panel] = !this.expandedPanels[panel];
  }

  refreshData() {
    this.loadTrackedSymbols();
    this.loadAllMarketData();
    if (this.selectedSymbol) {
      this.onSelectSymbol(this.selectedSymbol);
    }
  }

  getEndpoints(symbol: string): string[] {
    if (!this.dataPoints[symbol]) return [];
    return Object.keys(this.dataPoints[symbol]);
  }

  getLatestUpdate(symbol: string): Date | null {
    if (!this.dataPoints[symbol]) return null;
    
    let latestDate: Date | null = null;
    Object.values(this.dataPoints[symbol]).forEach(dataPoint => {
      if (!dataPoint.lastUpdated) return;
      
      // Handle case where lastUpdated might be a string or Date
      const lastUpdated = typeof dataPoint.lastUpdated === 'string' 
        ? new Date(dataPoint.lastUpdated) 
        : dataPoint.lastUpdated;
      
      if (!latestDate || lastUpdated > latestDate) {
        latestDate = lastUpdated;
      }
    });
    
    return latestDate;
  }

  getRefreshStatus(symbol: string, endpoint: string): string {
    if (!this.refreshEvents[symbol]?.[endpoint]) return 'No refresh events';
    
    const event = this.refreshEvents[symbol][endpoint];
    if (event.error) return `Error: ${event.error.message || 'Unknown error'}`;
    if (event.status === 'success') return 'Last refresh successful';
    return `Status: ${event.status}`;
  }

  testWriteAccess() {
    this.testingWrite = true;
    this.debugService.testWriteAccess().subscribe({
      next: (result) => {
        console.log('Write test result:', result);
        // You might want to show a snackbar or toast notification here
        alert(`Write test ${result.success ? 'succeeded' : 'failed'}: ${result.message}`);
        this.testingWrite = false;
      },
      error: (error) => {
        console.error('Error testing write access:', error);
        alert(`Error testing write access: ${error.message}`);
        this.testingWrite = false;
      }
    });
  }

  loadMarketDataStructure() {
    console.log('Loading market data structure...');
    this.loading = true;
    this.debugService.getMarketDataStructure().subscribe({
      next: (result) => {
        console.log('Market data structure:', result);
        this.marketDataStructure = result;
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading market data structure:', error);
        this.loading = false;
      }
    });
  }
}

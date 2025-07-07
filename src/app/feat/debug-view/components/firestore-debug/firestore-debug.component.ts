import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule, JsonPipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatTabsModule } from '@angular/material/tabs';
import { MatListModule } from '@angular/material/list';
import { MatChipsModule } from '@angular/material/chips';
import { FirestoreCollections } from '../../../../shared/constants/firestore-collections';
import { FirestoreDebugService } from '../../services/firestore-debug.service';
import { 
  TrackedSymbol, 
  EndpointData, 
  RefreshEvent 
} from '../../../data-maintainer-view/common/fe-common-dm-api';

 // for turning on/off console logs
 const pr = true;

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
  private cdr = inject(ChangeDetectorRef);
  
  FirestoreCollections = FirestoreCollections;
  
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
  debugInfo: any = null;
  isCheckingFirestore = false;

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
        if (pr) console.error('Error loading tracked symbols:', error);
        this.loading = false;
      }
    });
  }

  loadAllMarketData() {
    if (pr) console.log('Loading all market data...');
    this.loading = true;
    this.debugService.getAllMarketData().subscribe({
      next: (symbols: string[]) => {
        if (pr) console.log('Received market data symbols:', symbols);
        this.allSymbols = symbols;
        
        if (symbols.length === 0) {
          if (pr) console.warn('No market data symbols found in the database');
          this.loading = false;
          return;
        }
        
        // Load data points and refresh events for each symbol
        symbols.forEach(symbol => {
          if (pr) console.log(`Loading data for symbol: ${symbol}`);
          this.loadDataPoints(symbol);
          this.loadRefreshEvents(symbol);
        });
        
        this.loading = false;
      },
      error: (error: Error) => {
        if (pr) console.error('Error loading market data:', error);
        this.loading = false;
      }
    });
  }

  loadDataPoints(symbol: string) {
    if (pr) console.log(`Loading data points for symbol: ${symbol}`);
    this.debugService.getDataPoints(symbol).subscribe({
      next: (endpoints: string[]) => {
        if (pr) console.log(`Found ${endpoints.length} data point endpoints for ${symbol}:`, endpoints);
        if (!this.dataPoints[symbol]) this.dataPoints[symbol] = {};
        
        if (endpoints.length === 0) {
          if (pr) console.warn(`No data point endpoints found for symbol: ${symbol}`);
          return;
        }
        
        endpoints.forEach(endpoint => {
          if (pr) console.log(`Loading data point for ${symbol} - ${endpoint}`);
          this.debugService.getDataPoint(symbol, endpoint).subscribe({
            next: (data) => {
              if (data) {
                if (pr) console.log(`Successfully loaded data point for ${symbol} - ${endpoint}`);
                this.dataPoints[symbol][endpoint] = data;
              } else {
                if (pr) console.warn(`No data returned for ${symbol} - ${endpoint}`);
              }
            },
            error: (err) => {
              if (pr) console.error(`Error loading data point for ${symbol} - ${endpoint}:`, err);
            }
          });
        });
      },
      error: (error: Error) => {
        if (pr) console.error(`Error loading data points for ${symbol}:`, error);
      }
    });
  }

  loadRefreshEvents(symbol: string) {
    if (pr) console.log(`Loading refresh events for symbol: ${symbol}`);
    this.debugService.getRefreshEventEndpoints(symbol).subscribe({
      next: (endpoints: string[]) => {
        if (pr) console.log(`Found ${endpoints.length} refresh event endpoints for ${symbol}:`, endpoints);
        if (!this.refreshEvents[symbol]) this.refreshEvents[symbol] = {};
        
        if (endpoints.length === 0) {
          if (pr) console.warn(`No refresh event endpoints found for symbol: ${symbol}`);
          return;
        }
        
        endpoints.forEach(endpoint => {
          if (pr) console.log(`Loading refresh event for ${symbol} - ${endpoint}`);
          this.debugService.getRefreshEvent(symbol, endpoint).subscribe({
            next: (event) => {
              if (event) {
                if (pr) console.log(`Successfully loaded refresh event for ${symbol} - ${endpoint}`);
                this.refreshEvents[symbol][endpoint] = event;
              } else {
                if (pr) console.warn(`No refresh event data returned for ${symbol} - ${endpoint}`);
              }
            },
            error: (err) => {
              if (pr) console.error(`Error loading refresh event for ${symbol} - ${endpoint}:`, err);
            }
          });
        });
      },
      error: (error: Error) => {
        if (pr) console.error(`Error loading refresh event endpoints for ${symbol}:`, error);
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
        if (pr) console.log('Write test result:', result);
        // You might want to show a snackbar or toast notification here
        alert(`Write test ${result.success ? 'succeeded' : 'failed'}: ${result.message}`);
        this.testingWrite = false;
      },
      error: (error) => {
        if (pr) console.error('Error testing write access:', error);
        alert(`Error testing write access: ${error.message}`);
        this.testingWrite = false;
      }
    });
  }

  loadMarketDataStructure() {
    if (pr) console.log('Loading market data structure...');
    this.loading = true;
    this.debugService.getMarketDataStructure().subscribe({
      next: (result) => {
        if (pr) console.log('Market data structure:', result);
        this.marketDataStructure = result;
        this.loading = false;
      },
      error: (error) => {
        if (pr) console.error('Error loading market data structure:', error);
        this.loading = false;
      }
    });
  }

  checkFirestoreData(): void {
    console.log('[FirestoreDebug] Checking Firestore data...');
    this.isCheckingFirestore = true;
    
    this.debugService.debugCheckFirestoreData().subscribe({
      next: (debugInfo) => {
        console.log('[FirestoreDebug] Firestore debug info:', debugInfo);
        this.debugInfo = debugInfo;
        this.isCheckingFirestore = false;
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('[FirestoreDebug] Error checking Firestore data:', error);
        this.debugInfo = { 
          error: error.message,
          stack: error.stack 
        };
        this.isCheckingFirestore = false;
        this.cdr.detectChanges();
      }
    });
  }
}

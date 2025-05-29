import { Component, inject, signal } from '@angular/core';
import { MatDividerModule } from '@angular/material/divider';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule, ReactiveFormsModule, FormGroup, FormControl } from '@angular/forms';
import { JsonPipe, CommonModule } from '@angular/common';
import { StockDataUrl } from '../common/common-app';
import { MaterialModule } from '../shared/material.module';
import { Auth } from '@angular/fire/auth';

@Component({
    selector: 'app-stock-data',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule, 
        ReactiveFormsModule, 
        JsonPipe,
        MatDividerModule,
        MaterialModule
    ],
    templateUrl: './stock-data.component.html',
    styleUrls: ['./stock-data.component.scss']
})
export class StockDataComponent {
  // Expose StockDataUrl to template
  StockDataUrl = StockDataUrl;

  private http = inject(HttpClient);
  private auth = inject(Auth);

  // Component properties
  stockData: any = null; // Or a more specific interface if you have one
  errorMessage: string = '';
  isLoading = false;

  // Signals
  functionToUse = signal<string>(StockDataUrl.DAILY_STOCK_DATA_SIMPLE)

  // Form
  stockForm = new FormGroup({
    tickerSymbol: new FormControl({ value: '', disabled: false })
  });

  // Methods
  toggleFunction() {
    this.functionToUse.set(this.functionToUse() === StockDataUrl.DAILY_STOCK_DATA_SIMPLE ? StockDataUrl.GET_GLOBAL_QUOTE : StockDataUrl.DAILY_STOCK_DATA_SIMPLE);
  }

  async onSubmit() {
    if (this.isLoading) return;
    
    const tickerSymbol = this.stockForm.get('tickerSymbol')?.value;
    if (!tickerSymbol) {
      this.errorMessage = 'Please enter a ticker symbol.';
      this.stockData = null;
      return;
    }
    
    // Disable form during submission
    this.stockForm.disable();
    this.isLoading = true;
    console.log('sD oS tickerSymbol: ', tickerSymbol);
    if (!tickerSymbol) {
      this.errorMessage = 'Please enter a ticker symbol.';
      this.stockData = null;
      return;
    }

    try {
      // Get the current user from Firebase Auth
      const user = this.auth.currentUser;
      if (!user) {
        this.errorMessage = 'Please sign in to fetch stock data.';
        return;
      }

      // Get the ID token
      const idToken = await user.getIdToken();
      
      const url = `${this.functionToUse()}?symbol=${tickerSymbol.toUpperCase()}`;
      console.log('sD oS url: ', url);
      this.errorMessage = ''; // Clear previous errors
      this.stockData = null; // Clear previous data before new request
      this.isLoading = true;

      // Make the request with the ID token in the Authorization header
      const headers = new HttpHeaders({
        'Authorization': `Bearer ${idToken}`
      });

      const response = await this.http.get(url, { headers }).toPromise();
      this.stockData = response;
    } catch (error: any) {
    //   console.error('Error fetching stock data:', error.message);
      console.error('Error fetching stock data dude:');
      this.errorMessage = 'Error fetching stock data. Please try again.';
      
      if (error.status === 401 || error.status === 403) {
        this.errorMessage = 'Authentication error. Please sign in again.';
      } else if (error.error?.message) {
        this.errorMessage = error.error.message;
      }
    } finally {
      this.isLoading = false;
      // Re-enable form after submission is complete
      this.stockForm.enable();
    }
  }
}

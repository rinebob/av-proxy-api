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
    
    console.log('--- sD oS onSubmit: Starting request ---');
    console.log('Using function:', this.functionToUse());
    console.log('Form value:', this.stockForm.value);
    
    // Get current user and token
    const user = this.auth.currentUser;
    console.log('Current user:', user ? {
      uid: user.uid,
      email: user.email,
      emailVerified: user.emailVerified
    } : 'No user signed in');
    
    if (!user) {
      this.errorMessage = 'You must be logged in to fetch stock data.';
      return;
    }
    
    let idToken: string;
    try {
      idToken = await user.getIdToken();
      console.log('ID token retrieved, length:', idToken.length);
      console.log('ID token first 10 chars:', `${idToken.substring(0, 10)}...`);
    } catch (error) {
      console.error('Error getting ID token:', error);
      this.errorMessage = 'Authentication error. Please sign in again.';
      return;
    }
    
    // Prepare request
    const symbol = this.stockForm.get('tickerSymbol')?.value?.trim().toUpperCase() || '';
    if (!symbol) {
      console.warn('No symbol provided');
      this.errorMessage = 'Please enter a stock symbol';
      return;
    }
    
    const url = this.functionToUse();
    const params = { symbol };
    const headers = new HttpHeaders({
      'Authorization': `Bearer ${idToken}`,
      'X-Debug-Request': 'true'
    });
    
    console.log('Sending request:', { 
      url, 
      params, 
      headers: Object.fromEntries(headers.keys().map(k => [k, k === 'Authorization' ? 'Bearer ***' : '***'])) 
    });
    
    this.isLoading = true;
    this.errorMessage = '';
    this.stockData = null;
    
    const startTime = Date.now();
    try {
      console.log('Sending HTTP request...');
      
      const response = await this.http.get(url, { 
        params,
        headers,
        observe: 'response'
      }).toPromise();
      
      if (!response) {
        throw new Error('No response received from server');
      }
      
      const endTime = Date.now();
      console.log(`Request completed in ${endTime - startTime}ms`);
      console.log('Response status:', response.status, response.statusText);
      console.log('Response headers:', 
        Array.from(response.headers.keys())
          .map(k => `${k}: ${response.headers.get(k)}`)
          .join('\n  ')
      );
      console.log('Response body:', response.body);
      
      this.stockData = response.body;
      console.log('Stock data received:', this.stockData);
      
    } catch (error: any) {
      const endTime = Date.now();
      const duration = error ? `${endTime - startTime}ms` : 'unknown time';
      console.error(`Request failed after ${duration}`, error);
      
      if (error?.error) {
        console.error('Error response body:', error.error);
        if (error.error instanceof Blob) {
          // If the error is a Blob, read it as text
          try {
            const errorText = await error.error.text();
            console.error('Error response body (as text):', errorText);
          } catch (e) {
            console.error('Could not read error blob:', e);
          }
        }
      }
      
      // Extract the error message from the error object
      const errorMessage = error?.error?.error || error?.message || 'An unexpected error occurred';
      
      // Log the full error for debugging
      console.error('Error details:', { 
        status: error?.status,
        message: errorMessage,
        error: error?.error 
      });
      
      // Set appropriate error message based on status code and content
      if (error?.status === 0) {
        this.errorMessage = 'Network error. Please check your connection.';
      } else if (error?.status === 401) {
        this.errorMessage = 'Session expired. Please sign in again.';
      } else if (error?.status === 403) {
        this.errorMessage = 'Access denied. You do not have permission to access this resource.';
      } else if (error?.status === 404) {
        this.errorMessage = 'The requested resource was not found.';
      } else if (error?.status === 429 || errorMessage?.toLowerCase().includes('rate limit')) {
        this.errorMessage = 'API rate limit reached. Please try again later or upgrade your Alpha Vantage API plan.';
      } else if (error?.status && error.status >= 500) {
        this.errorMessage = 'Server error. Please try again later.';
      } else {
        // Show the extracted error message for other cases
        this.errorMessage = errorMessage;
      }
      
      console.error('Error details:', error);
    } finally {
      this.isLoading = false;
      console.log('--- Request completed ---');
    }  
    this.stockForm.enable();
  }
}

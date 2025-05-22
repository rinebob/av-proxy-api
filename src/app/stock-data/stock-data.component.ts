import { Component, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule, ReactiveFormsModule, FormGroup, FormControl } from '@angular/forms';
import { JsonPipe } from '@angular/common';
 
// const DAILY_STOCK_DATA_URL = 'https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/getDailyStockDataSimple';
const DAILY_STOCK_DATA_URL = 'https://getdailystockdatasimple-lsluydmucq-uc.a.run.app';

@Component({
  selector: 'app-stock-data',
  standalone: true,
  imports: [FormsModule, ReactiveFormsModule, JsonPipe],
 
  templateUrl: './stock-data.component.html',
  styleUrl: './stock-data.component.css'
})
export class StockDataComponent {
 stockForm = new FormGroup({
    tickerSymbol: new FormControl('')
 });
  stockData: any = null; // Or a more specific interface if you have one
  errorMessage: string = '';


  // Replace with your actual Firebase Function URL
  private firebaseFunctionUrl = DAILY_STOCK_DATA_URL;

  private http = inject(HttpClient);

  onSubmit() {
    const tickerSymbol = this.stockForm.value.tickerSymbol;
    console.log('sD oS tickerSymbol: ', tickerSymbol);
    if (!tickerSymbol) {
      this.errorMessage = 'Please enter a ticker symbol.';
      return;
    }
 
    const url = `${this.firebaseFunctionUrl}?symbol=${tickerSymbol.toUpperCase()}`;
    this.errorMessage = ''; // Clear previous errors


    this.http.get(url).subscribe({ // Use the subscribe method with an observer object
      next: (data) => {
        this.stockData = data;
        console.log('Stock Data:', this.stockData); // Optional: log the data
      },
      error: (error) => {
        console.log('sD oS url: ', url);
        console.log('sD oS tickerSymbol: ', tickerSymbol);
        console.error('Error fetching stock data:', error);
        this.errorMessage = 'Error fetching stock data: ' + (error.message || 'Unknown error'); // Provide a more informative error
        this.stockData = null; // Clear previous data on error if any
      }
    });
  }
}

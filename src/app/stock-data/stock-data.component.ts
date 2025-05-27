import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule, ReactiveFormsModule, FormGroup, FormControl } from '@angular/forms';
import { JsonPipe } from '@angular/common';
import { StockDataUrl } from '../common/common-app';

@Component({
    selector: 'app-stock-data',
    standalone: true,
    imports: [FormsModule, ReactiveFormsModule, JsonPipe],
    templateUrl: './stock-data.component.html',
    styleUrl: './stock-data.component.css'
})
export class StockDataComponent {

    private http = inject(HttpClient);

    functionToUse = signal<string>(StockDataUrl.DAILY_STOCK_DATA_SIMPLE)

    stockForm = new FormGroup({
        tickerSymbol: new FormControl('')
    });

    stockData: any = null; // Or a more specific interface if you have one
    errorMessage: string = '';

    toggleFunction() {
        this.functionToUse.set(this.functionToUse() === StockDataUrl.DAILY_STOCK_DATA_SIMPLE ? StockDataUrl.GET_GLOBAL_QUOTE : StockDataUrl.DAILY_STOCK_DATA_SIMPLE);
    }

    onSubmit() {
        const tickerSymbol = this.stockForm.value.tickerSymbol;
        console.log('sD oS tickerSymbol: ', tickerSymbol);
        if (!tickerSymbol) {
            this.errorMessage = 'Please enter a ticker symbol.';
            this.stockData = null;
            return;
        }

        const url = `${this.functionToUse()}?symbol=${tickerSymbol.toUpperCase()}`;
        console.log('sD oS url: ', url);
        this.errorMessage = ''; // Clear previous errors
        this.stockData = null; // Clear previous data before new request

        // The AuthInterceptor will automatically add the Authorization header if a user is signed in.
        // If no user is signed in, or token is unavailable, the interceptor currently lets the request pass,
        // and the backend will return a 401/403, which will be caught by the error block below.
        this.http.get(url).subscribe({
            next: (data) => {
                console.log('sD oS url: ', url);
                console.log('sD oS tickerSymbol: ', tickerSymbol);
                this.stockData = data;
                console.log('sD oS stock Data:', this.stockData); // Optional: log the data
            },
            error: (error) => {
                console.log('sD oS url: ', url);
                console.log('sD oS tickerSymbol: ', tickerSymbol);
                console.error('sD oS dude - error fetching stock data:', error);
                // More specific error handling based on status
                if (error.status === 401 || error.status === 403) {
                    this.errorMessage = 'Authentication failed. Please ensure you are signed in correctly.';
                } else {
                    this.errorMessage = 'Error fetching stock data: ' + (error.error?.message || error.message || 'Unknown error');
                }
                this.stockData = null; // Clear previous data on error if any
            }
        });
    }
}

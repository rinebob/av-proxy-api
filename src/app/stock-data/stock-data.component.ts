import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule, ReactiveFormsModule, FormGroup, FormControl } from '@angular/forms';
import { JsonPipe } from '@angular/common';
const DAILY_STOCK_DATA_URL_ROBUST = 'https://getdailystockdatarobust-lsluydmucq-uc.a.run.app';
const DAILY_STOCK_DATA_URL_SIMPLE = 'https://getdailystockdatasimple-lsluydmucq-uc.a.run.app';

@Component({
    selector: 'app-stock-data',
    standalone: true,
    imports: [FormsModule, ReactiveFormsModule, JsonPipe],
    templateUrl: './stock-data.component.html',
    styleUrl: './stock-data.component.css'
})
export class StockDataComponent {

    private http = inject(HttpClient);

    functionToUse = signal<string>(DAILY_STOCK_DATA_URL_SIMPLE)

    stockForm = new FormGroup({
        tickerSymbol: new FormControl('')
    });

    stockData: any = null; // Or a more specific interface if you have one
    errorMessage: string = '';

    toggleFunction() {
        this.functionToUse.set(this.functionToUse() === DAILY_STOCK_DATA_URL_SIMPLE ? DAILY_STOCK_DATA_URL_ROBUST : DAILY_STOCK_DATA_URL_SIMPLE);
    }

    onSubmit() {
        const tickerSymbol = this.stockForm.value.tickerSymbol;
        console.log('sD oS tickerSymbol: ', tickerSymbol);
        if (!tickerSymbol) {
            this.errorMessage = 'Please enter a ticker symbol.';
            return;
        }

        const url = `${this.functionToUse()}?symbol=${tickerSymbol.toUpperCase()}`;
        console.log('sD oS url: ', url);
        this.errorMessage = ''; // Clear previous errors


        this.http.get(url).subscribe({ // Use the subscribe method with an observer object
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
                this.errorMessage = 'Error fetching stock data: ' + (error.message || 'Unknown error'); // Provide a more informative error
                this.stockData = null; // Clear previous data on error if any
            }
        });
    }
}

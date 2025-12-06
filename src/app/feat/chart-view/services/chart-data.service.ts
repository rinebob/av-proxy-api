import { Injectable, inject } from '@angular/core';
import { Firestore, collection, collectionData, doc, docData } from '@angular/fire/firestore';
import { Observable, map } from 'rxjs';
import { FirestoreCollection } from '@shared/firestore';

@Injectable({
  providedIn: 'root'
})
export class ChartDataService {
  private firestore = inject(Firestore);

  getTrackedSymbols(): Observable<string[]> {
    const symbolsRef = collection(this.firestore, FirestoreCollection.TRACKED_SYMBOLS);
    return collectionData(symbolsRef, { idField: 'symbol' }).pipe(
      map((docs: any[]) => docs.map(d => d.symbol).sort())
    );
  }

  getYearlyData(symbol: string, year: number, isSplitAdjusted: boolean = false): Observable<any> {
    const timeSeriesCollection = isSplitAdjusted ? FirestoreCollection.SA_TIME_SERIES : FirestoreCollection.TIME_SERIES;
    // Currently hardcoded to av-daily-adjusted as per requirements. 
    // In the future this could be dynamic based on vendor/endpoint.
    const docId = `av-${FirestoreCollection.DAILY_ADJUSTED}`; 
    
    const path = `${FirestoreCollection.SYMBOL_DATA}/${symbol}/${timeSeriesCollection}/${docId}/${FirestoreCollection.YEARS}/${year}`;
    const docRef = doc(this.firestore, path);
    return docData(docRef);
  }

  getAllTimeSeriesData(symbol: string, isSplitAdjusted: boolean = false): Observable<any[]> {
    const timeSeriesCollection = isSplitAdjusted ? FirestoreCollection.SA_TIME_SERIES : FirestoreCollection.TIME_SERIES;
    const docId = `av-${FirestoreCollection.DAILY_ADJUSTED}`;
    const path = `${FirestoreCollection.SYMBOL_DATA}/${symbol}/${timeSeriesCollection}/${docId}/${FirestoreCollection.YEARS}`;
    const yearsRef = collection(this.firestore, path);
    
    // Fetch all year documents
    return collectionData(yearsRef);
  }
}

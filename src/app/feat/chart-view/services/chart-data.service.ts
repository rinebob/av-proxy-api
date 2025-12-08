import { Injectable, inject } from '@angular/core';
import { Firestore, collection, collectionData, doc, docData } from '@angular/fire/firestore';
import { Observable, map } from 'rxjs';
import { FirestoreCollection } from '@shared/firestore';
import { TimeSeriesInterval } from '@shared/alpha-vantage';

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

  getAllTimeSeriesData(symbol: string, isSplitAdjusted: boolean = false, interval: TimeSeriesInterval = TimeSeriesInterval.DAILY): Observable<any[]> {
    const timeSeriesCollection = isSplitAdjusted ? FirestoreCollection.SA_TIME_SERIES : FirestoreCollection.TIME_SERIES;
    
    // Construct docId based on interval
    let docId: string;
    switch (interval) {
      case TimeSeriesInterval.WEEKLY:
        docId = `av-${FirestoreCollection.WEEKLY_ADJUSTED}`;
        break;
      case TimeSeriesInterval.MONTHLY:
        docId = `av-${FirestoreCollection.MONTHLY_ADJUSTED}`;
        break;
      case TimeSeriesInterval.DAILY:
      default:
        docId = `av-${FirestoreCollection.DAILY_ADJUSTED}`;
        break;
    }
    
    // Handle special path for Monthly "all" doc
    if (interval === TimeSeriesInterval.MONTHLY) {
      // Monthly uses a single 'all' doc instead of year shards
      // Path: symbol-data/{symbol}/{collection}/{docId}/all/data
      const path = `${FirestoreCollection.SYMBOL_DATA}/${symbol}/${timeSeriesCollection}/${docId}/all/data`;
      const docRef = doc(this.firestore, path);
      return docData(docRef).pipe(
        map((doc: any) => doc?.bars || [])
      );
    } else {
      // Daily/Weekly use year shards
      const path = `${FirestoreCollection.SYMBOL_DATA}/${symbol}/${timeSeriesCollection}/${docId}/${FirestoreCollection.YEARS}`;
      const yearsRef = collection(this.firestore, path);
      return collectionData(yearsRef);
    }
  }
}

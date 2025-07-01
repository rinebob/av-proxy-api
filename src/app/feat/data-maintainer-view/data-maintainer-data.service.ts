import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AvCompanyOverviewResponse, DataMaintainerFunctionName, getDataMaintainerFunctionUrl } from './common/fe-common-dm-api';
import { DataMaintainerEndpoint } from './common/fe-common-dm';

@Injectable({ providedIn: 'root' })
export class DataMaintainerDataService {
  private http = inject(HttpClient);

  /**
   * Fetches Alpha Vantage company overview data for the given symbol.
   * @param symbol The stock symbol to fetch data for
   */
  fetchCompanyOverview(symbol: string, useMock: boolean = true): Observable<AvCompanyOverviewResponse> {
    const requestData = { 
      symbol, 
      endpoint: DataMaintainerEndpoint.COMPANY_OVERVIEW,
      useMock 
    };
    
    console.log('DMV fCO Sending request with data:', JSON.stringify(requestData, null, 2));
    
    return this.http.post<AvCompanyOverviewResponse>(
      getDataMaintainerFunctionUrl(DataMaintainerFunctionName.FETCH_AND_STORE_DATA),
      requestData
    ).pipe(
      tap({
        next: (response) => console.log('DMV fCO Received response:', response ? 'Response received' : 'Empty response'),
        error: (error) => console.error('DMV fCO Error:', error)
      })
    );
  }
}

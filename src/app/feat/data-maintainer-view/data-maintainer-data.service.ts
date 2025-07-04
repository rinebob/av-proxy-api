import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, of, tap } from 'rxjs';
import { Auth } from '@angular/fire/auth';
import { DataMaintainerEndpoint } from './common/fe-common-dm';
import { 
  ApiResponse, 
  AvCompanyOverviewResponse, 
  DataMaintainerFunctionName,
  getDataMaintainerFunctionUrl
} from './common/fe-common-dm-api';

// Define the expected response shape from the syncSymbols endpoint
interface SymbolSyncResponse {
  success: boolean;
  message?: string;
  added: number;
  removed: number;
  totalActive: number;
  addedCount?: number;
  removedCount?: number;
  totalTracked?: number;
}

export type CompanyOverviewData = ApiResponse<AvCompanyOverviewResponse['data']>;

export interface CheckMockDataResponse {
  hasMockData: boolean;
  endpoint: DataMaintainerEndpoint;
  symbol: string;
}

@Injectable({
  providedIn: 'root'
})
export class DataMaintainerDataService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(Auth);

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
        next: (response: any) => {
          console.log('DMV fCO Received response:', response ? {
            ok: response.ok,
            symbol: response.symbol,
            endpoint: response.endpoint,
            data: response.data ? '[data exists]' : 'no data'
          } : 'Empty response');
        },
        error: (error) => console.error('DMV fCO Error:', error)
      })
    );
  }

  /**
   * Checks if mock data is available for a given symbol and endpoint
   * @param symbol The stock symbol to check
   * @param endpoint The endpoint to check
   * @returns Observable with the check result
   */
  checkMockData(symbol: string, endpoint: DataMaintainerEndpoint): Observable<CheckMockDataResponse> {
    const requestData = { symbol, endpoint };
    
    console.log('DMV cMD Checking mock data for:', JSON.stringify(requestData, null, 2));
    
    // Get the URL for the checkMockData function
    const url = getDataMaintainerFunctionUrl(DataMaintainerFunctionName.CHECK_MOCK_DATA);
    
    return this.http.post<CheckMockDataResponse>(url, requestData).pipe(
      tap({
        next: (response: any) => console.log('DMV cMD Mock data check result:', response),
        error: (error) => console.error('DMV cMD Error checking mock data:', error)
      })
    );
  }


}

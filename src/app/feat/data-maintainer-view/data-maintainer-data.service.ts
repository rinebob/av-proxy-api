import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AvCompanyOverviewResponse, DataMaintainerFunctionName, getDataMaintainerFunctionUrl } from './common/fe-common-dm-api';
import { DataMaintainerEndpoint } from './common/fe-common-dm';

@Injectable({ providedIn: 'root' })
export class DataMaintainerDataService {
  private http = inject(HttpClient);

  /**
   * Fetches Alpha Vantage company overview data for the given symbol.
   * @param symbol The stock symbol to fetch data for
   */
  fetchCompanyOverview(symbol: string): Observable<AvCompanyOverviewResponse> {
    return this.http.post<AvCompanyOverviewResponse>(
      getDataMaintainerFunctionUrl(DataMaintainerFunctionName.FETCH_AND_STORE_DATA),
      { symbol, endpoint: DataMaintainerEndpoint.COMPANY_OVERVIEW }
    );
  }
}

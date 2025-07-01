import { Component, signal, input } from '@angular/core';
import { CommonModule } from '@angular/common';

import { DataMaintainerEndpoint } from '../common/fe-common-dm';

/**
 * Button row for selecting endpoints in Data Maintainer view.
 * Standalone, minimal, and ready for signal-based parent interaction.
 */
@Component({
  selector: 'app-endpoint-selector-row',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './endpoint-selector-row.component.html',
  styleUrls: ['./endpoint-selector-row.component.scss'],
})
export class EndpointSelectorRowComponent {
  // In the future, endpoints can be passed as input
  // For now, hardcode a few example endpoints for demo
  endpoints = [
    { key: DataMaintainerEndpoint.COMPANY_OVERVIEW, label: 'Company Overview', disabled: false },
    { key: DataMaintainerEndpoint.BALANCE_SHEET, label: 'Balance Sheet', disabled: true },
    { key: DataMaintainerEndpoint.INCOME_STATEMENT, label: 'Income Statement', disabled: true },
    { key: DataMaintainerEndpoint.CASH_FLOW, label: 'Cash Flow', disabled: true },
    { key: DataMaintainerEndpoint.EARNINGS, label: 'Earnings', disabled: true },
    { key: DataMaintainerEndpoint.LISTING_STATUS, label: 'Listing Status', disabled: true },
    { key: DataMaintainerEndpoint.IPO_CALENDAR, label: 'IPO Calendar', disabled: true },
    { key: DataMaintainerEndpoint.SECTOR_PERFORMANCE, label: 'Sector Performance', disabled: true },
    { key: DataMaintainerEndpoint.OVERVIEW, label: 'Overview', disabled: true },
    { key: DataMaintainerEndpoint.SYMBOL_SEARCH, label: 'Symbol Search', disabled: true },
    { key: DataMaintainerEndpoint.TIME_SERIES, label: 'Time Series', disabled: true },
    { key: DataMaintainerEndpoint.QUOTE_ENDPOINT, label: 'Quote Endpoint', disabled: true },
    // Add more endpoints as needed
  ];
  selected = signal(DataMaintainerEndpoint.COMPANY_OVERVIEW);

  selectEndpoint(key: DataMaintainerEndpoint) {
    console.log('[EndpointSelectorRow] selectEndpoint:', key);
    this.selected.set(key);
    // Emit event or call parent logic here if needed
  }
}

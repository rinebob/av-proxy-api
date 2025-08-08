import { Component, signal, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { inject } from '@angular/core';
import { AlphaVantageStore } from '../store/alpha-vantage.store';
import { AlphaVantageEndpoint } from '@shared/alpha-vantage';
import { DATA_MAINTAINER_ENDPOINTS_METADATA } from '../common/fe-common-dm';

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
  alphaVantageStore = inject(AlphaVantageStore);
  endpoints = DATA_MAINTAINER_ENDPOINTS_METADATA;
  currentEndpoint = this.alphaVantageStore.endpoint;

  selectEndpoint(key: AlphaVantageEndpoint) {
    console.log('Endpoint selected:', key);
    this.alphaVantageStore.setEndpoint(key);
  }
}

import { Component, signal, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { inject } from '@angular/core';
import { DataMaintainerStore } from '../data-maintainer.store';
import { DataMaintainerEndpoint, DATA_MAINTAINER_ENDPOINTS_METADATA } from '../common/fe-common-dm';

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
  dataMaintainerStore = inject(DataMaintainerStore);
  endpoints = DATA_MAINTAINER_ENDPOINTS_METADATA;

  selectEndpoint(key: DataMaintainerEndpoint) {
    console.log('eSR sE selected endpoint:', key);
    this.dataMaintainerStore.setEndpoint(key);
  }
}

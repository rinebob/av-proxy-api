import { Component, inject } from '@angular/core';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { CommonModule } from '@angular/common';

import { BENZINGA_ENDPOINTS_META_MAP, BenzingaEndpoint } from '../../../../common/fe-common-bz';
import { BenzingaCalendarStore } from '../../store/bz-calendar.store';

/**
 * Row of buttons to select Benzinga endpoint.
 * Interacts with NgRx Signal Store for state.
 */
@Component({
  selector: 'bz-endpoint-selector',
  standalone: true,
  imports: [
    MatButtonToggleModule,
    CommonModule
  ],
  templateUrl: './bz-endpoint-selector.component.html',
  styleUrls: ['./bz-endpoint-selector.component.scss']
})
/**
 * Endpoint selector for Benzinga calendar endpoints.
 * Binds to selectedEndpoint in the NgRx Signal Store.
 */
export class BzEndpointSelectorComponent {
  /**
   * Endpoints to exclude from selector
   */
  excludedEndpoints: BenzingaEndpoint[] = [
    BenzingaEndpoint.FDA,
    BenzingaEndpoint.MERGERS_ACQUISITIONS,
    BenzingaEndpoint.OFFERINGS
  ];
  bzCalendarEndpoints = Object.values(BenzingaEndpoint);
  calendarTypeMetadataMap = BENZINGA_ENDPOINTS_META_MAP;

  /**
   * Inject the BenzingaCalendarStore as bzCalendarStore
   */
  bzCalendarStore = inject(BenzingaCalendarStore);

  /**
   * Signal for the currently selected endpoint
   */
  selectedEndpoint = this.bzCalendarStore.selectedEndpoint; // This will default to BenzingaEndpoint.EARNINGS

  /**
   * Handler for endpoint change
   */
  onEndpointChange(endpoint: BenzingaEndpoint) {
    this.bzCalendarStore.setSelectedEndpoint(endpoint);
  }
}


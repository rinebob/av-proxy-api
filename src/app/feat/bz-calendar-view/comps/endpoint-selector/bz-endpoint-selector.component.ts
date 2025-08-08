import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonToggleModule } from '@angular/material/button-toggle';

import { BzCalendarRequestType } from '@shared/benzinga';

import { BenzingaCalendarStore } from '../../store/bz-calendar.store';
import { BENZINGA_ENDPOINTS_META_MAP } from 'src/app/common/fe-common-bz';

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
  calendarTypeMetadataMap = BENZINGA_ENDPOINTS_META_MAP;

  /**
   * Inject the BenzingaCalendarStore as bzCalendarStore
   */
  bzCalendarStore = inject(BenzingaCalendarStore);

  bzCalendarEndpoints = Object.values(BzCalendarRequestType);

  /**
   * Signal for the currently selected endpoint
   */
  selectedEndpoint = this.bzCalendarStore.selectedEndpoint; // This will default to BenzingaEndpoint.EARNINGS

  /**
   * Handler for endpoint change
   */
  onEndpointChange(endpoint: BzCalendarRequestType) {
    this.bzCalendarStore.setSelectedEndpoint(endpoint);
  }
}

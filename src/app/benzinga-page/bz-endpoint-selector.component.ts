import { Component, signal } from '@angular/core';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { CommonModule } from '@angular/common';
import { BENZINGA_ENDPOINTS_MAP, BenzingaEndpoint } from '../common/common-bz';

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
export class BzEndpointSelectorComponent {
  calendarTypes = Object.values(BenzingaEndpoint);
  calendarTypeMetadataMap = BENZINGA_ENDPOINTS_MAP;
}

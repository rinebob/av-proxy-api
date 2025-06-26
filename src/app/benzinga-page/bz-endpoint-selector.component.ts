import { Component, signal } from '@angular/core';

/**
 * Row of buttons to select Benzinga endpoint.
 * Interacts with NgRx Signal Store for state.
 */
@Component({
  selector: 'bz-endpoint-selector',
  standalone: true,
  templateUrl: './bz-endpoint-selector.component.html',
  styleUrls: ['./bz-endpoint-selector.component.scss']
})
export class BzEndpointSelectorComponent {}

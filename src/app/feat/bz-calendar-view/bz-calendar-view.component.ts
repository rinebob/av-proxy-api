import { Component, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';

import { BzEndpointSelectorComponent } from './comps/endpoint-selector/bz-endpoint-selector.component';
import { BzCalendarFormComponent } from './comps/calendar-form/bz-calendar-form.component';
import { BzEarningsTableComponent } from './comps/bz-earnings-table/bz-earnings-table.component';
import { BzNoResultsComponent } from './comps/bz-no-results/bz-no-results.component';
import { BenzingaCalendarStore } from './store/bz-calendar.store';
import { BenzingaEndpoint } from '../../common/common-bz';

@Component({
  selector: 'bz-calendar-view',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatCardModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatPaginatorModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTableModule,
    MatTabsModule,

    // New standalone components
    BzEndpointSelectorComponent,
    BzCalendarFormComponent,
    BzEarningsTableComponent,
    BzNoResultsComponent
],
  templateUrl: './bz-calendar-view.component.html',
  styleUrls: ['./bz-calendar-view.component.scss'],
  providers: [DatePipe]
})
export class BzCalendarViewComponent {

  public BenzingaEndpoint = BenzingaEndpoint;
  bzCalendarStore = inject(BenzingaCalendarStore);

  constructor() {}

}

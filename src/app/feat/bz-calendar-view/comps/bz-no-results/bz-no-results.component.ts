import { Component, Input } from '@angular/core';

import { MatIconModule } from '@angular/material/icon';

@Component({
    selector: 'bz-no-results',
    standalone: true,
    imports: [MatIconModule],
    templateUrl: './bz-no-results.component.html',
    styleUrls: ['./bz-no-results.component.scss']
})
export class BzNoResultsComponent {
    @Input({ required: true }) message!: string;
}

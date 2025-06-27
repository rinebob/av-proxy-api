import { Component, DestroyRef, inject } from '@angular/core';

import { BenzingaCalendarStore } from './store/bz-calendar.store';

@Component({
    template: ``,
})
export class BzCalendarViewBaseComponent {
    destroy = inject(DestroyRef);
    bzCalendarStore = inject(BenzingaCalendarStore);

    constructor() { 
        this.bzCalendarStore.selectedEndpoint$.subscribe(endpoint => {
            console.log('bCVBase selectedEndpoint: ', endpoint);
        });

        this.bzCalendarStore.selectedEndpointMeta$.subscribe(endpointMeta => {
            if (!endpointMeta) return;
            console.log('bCVBase columns: ', endpointMeta.columns);
            console.log('bCVBase selectedEndpointMeta: ', endpointMeta);
        });

        this.bzCalendarStore.formValues$.subscribe(formValues => {
            console.log('bCVBase formValues: ', formValues);
        });

        this.bzCalendarStore.responses$.subscribe(responses => {
            const endpoint = this.bzCalendarStore.selectedEndpoint();
            if (!endpoint) return;
            console.log('bCVBase endpoint responses: ', responses[endpoint]);
            console.log('bCVBase all responses: ', responses);
        });

        this.bzCalendarStore.pagedResults$.subscribe(pagedResults => {
            console.log('bCVBase pagedResults: ', pagedResults);
        });
    }

}

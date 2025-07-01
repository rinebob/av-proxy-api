import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EndpointSelectorRowComponent } from './comps/endpoint-selector-row.component';
import { DataMaintainerEndpoint } from './common/fe-common-dm';
import { DataMaintainerStore } from './data-maintainer.store';

@Component({
  selector: 'app-data-maintainer-view',
  standalone: true,
  templateUrl: './data-maintainer-view.component.html',
  styleUrls: ['./data-maintainer-view.component.scss'],
  imports: [CommonModule, JsonPipe, FormsModule, EndpointSelectorRowComponent],
})
export class DataMaintainerViewComponent {
  public readonly DataMaintainerEndpoint = DataMaintainerEndpoint;
  public dataMaintainerStore = inject(DataMaintainerStore);

  setSymbol(symbol: string) {
    this.dataMaintainerStore.setSymbol(symbol);
  }

  fetchCompanyOverview() {
    this.dataMaintainerStore.fetchCompanyOverview();
  }

  toggleMockData() {
    console.log('DMV tMD toggling mock data:', !this.dataMaintainerStore.useMock());
    this.dataMaintainerStore.toggleUseMock();
    // Refresh data with the new mock setting
    this.dataMaintainerStore.fetchCompanyOverview();
  }
}



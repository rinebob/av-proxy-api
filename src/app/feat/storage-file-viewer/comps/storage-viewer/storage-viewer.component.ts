import { ChangeDetectionStrategy, Component, inject, computed } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { CorpusViewerComponent } from '../corpus-viewer/corpus-viewer.component';
import { TimeSeriesViewerComponent } from '../time-series-viewer/time-series-viewer.component';
import { ContentSearchService } from '../../common/content-search.service';

/**
 * Top-level layout wrapper for the Storage File Viewer.
 * Hosts the shared find bar and renders both viewer columns side by side.
 */
@Component({
  selector: 'app-storage-viewer',
  standalone: true,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    CorpusViewerComponent,
    TimeSeriesViewerComponent,
  ],
  templateUrl: './storage-viewer.component.html',
  styleUrls: ['./storage-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StorageViewerComponent {
  private readonly searchService = inject(ContentSearchService);

  /** Current search term from the find bar. */
  readonly searchTerm = this.searchService.searchTerm;

  /** Corpus search navigation state. */
  readonly corpusCurrent = this.searchService.corpusCurrent;
  readonly corpusTotal = this.searchService.corpusTotal;

  /** Time-series search navigation state. */
  readonly tsCurrent = this.searchService.tsCurrent;
  readonly tsTotal = this.searchService.tsTotal;

  /** True when corpus has no matches (disables nav buttons). */
  readonly corpusNoMatches = computed(() => this.corpusTotal() === 0);

  /** True when time-series has no matches (disables nav buttons). */
  readonly tsNoMatches = computed(() => this.tsTotal() === 0);

  /** Update the search term as the user types. */
  onSearchInput(value: string): void {
    this.searchService.setSearchTerm(value);
  }

  onCorpusPrev(): void {
    this.searchService.prev('corpus');
  }

  onCorpusNext(): void {
    this.searchService.next('corpus');
  }

  onTsPrev(): void {
    this.searchService.prev('ts');
  }

  onTsNext(): void {
    this.searchService.next('ts');
  }
}

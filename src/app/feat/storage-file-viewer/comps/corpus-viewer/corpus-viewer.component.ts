import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, OnInit, DestroyRef } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { debounceTime, distinctUntilChanged } from 'rxjs';

import { CorpusViewerStore } from '../../store/corpus-viewer.store';
import { ContentViewerDirective } from '../../common/content-viewer.directive';
import { formatBytes } from '../../common/viewer-utils';

/**
 * Corpus viewer column component.
 * Displays corpus file list and content viewer side by side,
 * with a symbol + date filter form at the top.
 */
@Component({
  selector: 'app-corpus-viewer',
  standalone: true,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTooltipModule,
    ContentViewerDirective,
  ],
  templateUrl: './corpus-viewer.component.html',
  styleUrls: ['./corpus-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CorpusViewerComponent implements OnInit {
  protected readonly store = inject(CorpusViewerStore);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);

  /** FormControl for the symbol input (debounced). */
  readonly symbolCtrl = new FormControl('QQQ', { nonNullable: true });

  /** FormControl for the corpus date filter. */
  readonly dateFilterCtrl = new FormControl<string>('', { nonNullable: true });

  /** Track which list item is currently selected. */
  readonly selectedItemId = signal<string | null>(null);

  /** Signal tracking the current date filter text for corpus list filtering. */
  readonly dateFilterInput = toSignal(this.dateFilterCtrl.valueChanges, { initialValue: '' });

  /** Filtered corpus files based on the date filter text. */
  readonly filteredCorpusFiles = computed(() => {
    const input = this.dateFilterInput()?.trim().toLowerCase() ?? '';
    const files = this.store.corpusFiles();
    if (!input) return files;
    return files.filter((f) => f.date.includes(input));
  });

  /** Filtered dates based on the date filter text. */
  readonly filteredDates = computed<string[]>(() => {
    const input = this.dateFilterInput()?.trim().toLowerCase() ?? '';
    const dates = this.store.dates();
    if (!input) return dates;
    return dates.filter((d) => d.includes(input));
  });

  /** Raw content string from the store, bound to the ContentViewerDirective. */
  readonly rawContent = computed(() => {
    const result = this.store.readResult();
    return result ? result.content : '';
  });

  constructor() {
    // # Reason: Surface store errors via snackbar.
    effect(() => {
      const error = this.store.error();
      if (error) {
        this.snackBar.open(error, 'Dismiss', { duration: 5000 });
      }
    });
  }

  ngOnInit(): void {
    this.symbolCtrl.valueChanges.pipe(
      debounceTime(500),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((value) => {
      const trimmed = value.toUpperCase().trim();
      if (trimmed) {
        this.store.setSymbol(trimmed);
      }
    });
  }

  onList(): void {
    this.selectedItemId.set(null);
    this.store.clearRead();
    this.store.list();
  }

  onReadItem(id: string): void {
    this.selectedItemId.set(id);
    this.store.read(id);
  }

  onClearRead(): void {
    this.selectedItemId.set(null);
    this.store.clearRead();
  }

  /** Shared pure functions exposed to the template. */
  readonly formatBytes = formatBytes;
}

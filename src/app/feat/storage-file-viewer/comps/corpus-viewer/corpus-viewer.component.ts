import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, OnInit, DestroyRef } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatNativeDateModule } from '@angular/material/core';
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
    MatDatepickerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatNativeDateModule,
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

  /** FormControl for the corpus date picker (also accepts manual date entry). */
  readonly datePickerCtrl = new FormControl<Date | null>(null);

  /** Track which list item is currently selected. */
  readonly selectedItemId = signal<string | null>(null);

  /** Signal tracking the date picker value (Date | null). */
  readonly datePickerValue = toSignal(
    this.datePickerCtrl.valueChanges,
    { initialValue: null as Date | null },
  );

  /** Date filter string derived from the date picker (YYYY-MM-DD or empty). */
  private readonly dateFilterStr = computed(() => {
    const picker = this.datePickerValue();
    // # Reason: Use local date methods instead of toISOString() to avoid
    // timezone shifts — toISOString() converts to UTC, which can move the
    // date by one day in timezones ahead of UTC.
    return picker
      ? `${picker.getFullYear()}-${String(picker.getMonth() + 1).padStart(2, '0')}-${String(picker.getDate()).padStart(2, '0')}`
      : '';
  });

  /** Filtered corpus files based on the date picker. */
  readonly filteredCorpusFiles = computed(() => {
    const filter = this.dateFilterStr();
    const files = this.store.corpusFiles();
    if (!filter) return files;
    return files.filter((f) => f.date.includes(filter));
  });

  /** Filtered dates based on the date picker. */
  readonly filteredDates = computed<string[]>(() => {
    const filter = this.dateFilterStr();
    const dates = this.store.dates();
    if (!filter) return dates;
    return dates.filter((d) => d.includes(filter));
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

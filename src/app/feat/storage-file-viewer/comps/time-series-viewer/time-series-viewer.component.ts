import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, OnInit, DestroyRef } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { debounceTime, distinctUntilChanged } from 'rxjs';

import { TimeSeriesViewerStore } from '../../store/time-series-viewer.store';
import { ContentViewerDirective } from '../../common/content-viewer.directive';
import { formatStrike } from '../../common/viewer-utils';
import type { ContractResult } from '@shared/options';
import { classifyContractLength, calendarDaysBetween, dayOfWeek, formatDateWithDow } from '@shared/options';

/**
 * Time-series viewer column component.
 * Displays contract list (with metadata strip below) and content viewer side by side,
 * with a symbol + filters form at the top.
 */
@Component({
  selector: 'app-time-series-viewer',
  standalone: true,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatAutocompleteModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSnackBarModule,
    MatTooltipModule,
    ContentViewerDirective,
  ],
  templateUrl: './time-series-viewer.component.html',
  styleUrls: ['./time-series-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TimeSeriesViewerComponent implements OnInit {
  protected readonly store = inject(TimeSeriesViewerStore);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);

  /** FormControl for the symbol input (debounced). */
  readonly symbolCtrl = new FormControl('QQQ', { nonNullable: true });

  /** FormControl for the strike autocomplete. */
  readonly strikeCtrl = new FormControl<string>('', { nonNullable: true });

  /** FormControl for direct contract ID entry. */
  readonly contractIdCtrl = new FormControl<string>('', { nonNullable: true });

  /** Track which list item is currently selected. */
  readonly selectedItemId = signal<string | null>(null);

  /** Signal tracking the current strike input text for autocomplete filtering. */
  readonly strikeInput = toSignal(this.strikeCtrl.valueChanges, { initialValue: '' });

  /** Filtered strikes for autocomplete based on typed text. */
  readonly filteredStrikes = computed<string[]>(() => {
    const input = this.strikeInput()?.toLowerCase() ?? '';
    const strikes = this.store.filteredStrikes();
    if (!input) return strikes.map((s) => String(s));
    return strikes.filter((s) => String(s).includes(input)).map((s) => String(s));
  });

  /** Raw content string from the store, bound to the ContentViewerDirective. */
  readonly rawContent = computed(() => {
    const result = this.store.readResult();
    return result ? result.content : '';
  });

  /** Metadata field display order with human-readable labels. */
  private static readonly META_LABELS: ReadonlyArray<{ key: string; label: string }> = [
    { key: 'symbol', label: 'Symbol' },
    { key: 'contractID', label: 'Contract ID' },
    { key: 'expiration', label: 'Expiration' },
    { key: 'type', label: 'Type' },
    { key: 'strike', label: 'Strike' },
    { key: 'firstObserved', label: 'First Observed' },
    { key: 'lastObserved', label: 'Last Observed' },
    { key: 'observationCount', label: 'Observations' },
    { key: 'schemaVersion', label: 'Schema Version' },
  ];

  /** Metadata keys that contain ISO date values — DOW is appended for display. */
  private static readonly DATE_KEYS: ReadonlySet<string> = new Set([
    'expiration',
    'firstObserved',
    'lastObserved',
  ]);

  constructor() {
    // # Reason: Surface store errors via snackbar.
    effect(() => {
      const error = this.store.error();
      if (error) {
        this.snackBar.open(error, 'Dismiss', { duration: 5000 });
      }
    });

    // # Reason: Enable/disable strike control based on filter state to avoid
    // "changed after checked" errors from using [disabled] with reactive forms.
    effect(() => {
      const disabled = this.store.filtersDisabled();
      if (disabled) {
        this.strikeCtrl.disable();
      } else {
        this.strikeCtrl.enable();
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
        this.store.loadIndex();
      }
    });
  }

  onExpirationSelected(value: string | null): void {
    this.store.setExpiration(value ?? null);
  }

  onStrikeSelected(value: string): void {
    const num = value ? Number(value) : null;
    this.store.setStrike(Number.isFinite(num) ? num : null);
  }

  onOptionTypeChange(value: 'C' | 'P' | null): void {
    this.store.setOptionType(value);
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

  onReadContractId(): void {
    const id = this.contractIdCtrl.value.toUpperCase().trim();
    if (!id) return;
    this.selectedItemId.set(id);
    this.store.read(id);
  }

  /** Converts a metadata record into a labeled, ordered array for display. */
  metadataEntries(meta: Record<string, string>): Array<{ key: string; label: string; value: string }> {
    const known = TimeSeriesViewerComponent.META_LABELS
      .filter((m) => meta[m.key] !== undefined)
      .map((m) => {
        const raw = meta[m.key];
        const value = TimeSeriesViewerComponent.DATE_KEYS.has(m.key) ? formatDateWithDow(raw) : raw;
        return { key: m.key, label: m.label, value };
      });

    const knownKeys = new Set(TimeSeriesViewerComponent.META_LABELS.map((m) => m.key));
    const extra = Object.entries(meta)
      .filter(([k]) => !knownKeys.has(k))
      .map(([key, value]) => ({ key, label: key, value }));

    return [...known, ...extra];
  }

  /** Contract length label for a contract, derived from firstObserved → expiration. */
  contractLength(contract: ContractResult): string {
    if (!contract.firstObserved) return '—';
    const days = calendarDaysBetween(contract.firstObserved, contract.expiration);
    if (days === null) return '—';
    return classifyContractLength(days);
  }

  /** First trading date with day-of-week, or dash if missing. */
  firstTradingDate(contract: ContractResult): string {
    if (!contract.firstObserved) return '—';
    return formatDateWithDow(contract.firstObserved);
  }

  /** Shared pure functions exposed to the template. */
  readonly formatStrike = formatStrike;
  readonly dayOfWeek = dayOfWeek;
  readonly formatDateWithDow = formatDateWithDow;
}

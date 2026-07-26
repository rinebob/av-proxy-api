import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, OnInit, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { debounceTime, distinctUntilChanged } from 'rxjs';

import { StorageViewerStore } from '../../store/storage-viewer.store';
import type { BucketName, ContractResult } from '@shared/options';
import { classifyContractLength, calendarDaysBetween, dayOfWeek, formatDateWithDow } from '@shared/options';

const STRIKE_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

@Component({
  selector: 'app-storage-viewer',
  standalone: true,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatAutocompleteModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSnackBarModule,
    MatToolbarModule,
    MatTooltipModule,
  ],
  templateUrl: './storage-viewer.component.html',
  styleUrls: ['./storage-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StorageViewerComponent implements OnInit {
  protected readonly store = inject(StorageViewerStore);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);

  /** FormControl for the symbol input (debounced). */
  readonly symbolCtrl = new FormControl('QQQ', { nonNullable: true });

  /** FormControl for the strike autocomplete. */
  readonly strikeCtrl = new FormControl<string>('', { nonNullable: true });

  /** FormControl for direct contract ID entry. */
  readonly contractIdCtrl = new FormControl<string>('', { nonNullable: true });

  /** Track which list item is currently selected (contractId or date). */
  readonly selectedItemId = signal<string | null>(null);

  /** Filtered strikes for autocomplete based on typed text. */
  readonly filteredStrikes = computed<string[]>(() => {
    const input = this.strikeCtrl.value?.toLowerCase() ?? '';
    const strikes = this.store.filteredStrikes();
    if (!input) return strikes.map((s) => String(s));
    return strikes.filter((s) => String(s).includes(input)).map((s) => String(s));
  });

  constructor() {
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
        this.store.loadIndex();
      }
    });
  }

  onBucketChange(bucket: string): void {
    this.store.setBucket(bucket as BucketName);
    this.selectedItemId.set(null);
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

  /** True when the time-series bucket is active. */
  readonly isTimeSeries = computed(() => this.store.bucket() === 'time-series');

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

  /** Converts a metadata record into a labeled, ordered array for display. */
  metadataEntries(meta: Record<string, string>): Array<{ key: string; label: string; value: string }> {
    const known = StorageViewerComponent.META_LABELS
      .filter((m) => meta[m.key] !== undefined)
      .map((m) => {
        const raw = meta[m.key];
        const value = StorageViewerComponent.DATE_KEYS.has(m.key) ? formatDateWithDow(raw) : raw;
        return { key: m.key, label: m.label, value };
      });

    const knownKeys = new Set(StorageViewerComponent.META_LABELS.map((m) => m.key));
    const extra = Object.entries(meta)
      .filter(([k]) => !knownKeys.has(k))
      .map(([key, value]) => ({ key, label: key, value }));

    return [...known, ...extra];
  }

  /** Pretty-print JSONL content: parse each line as JSON and format with indentation. */
  formatContent(content: string): string {
    const lines = content.split('\n').filter((l) => l.trim());
    if (lines.length === 0) return content;

    try {
      const parsed = lines.map((line) => JSON.parse(line));
      return JSON.stringify(parsed, null, 2);
    } catch {
      // If parsing fails, try parsing as a single JSON object
      try {
        return JSON.stringify(JSON.parse(content), null, 2);
      } catch {
        // Fall back to raw content
        return content;
      }
    }
  }

  formatStrike(strike: number): string {
    return STRIKE_FORMATTER.format(strike);
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  /** Shared pure functions exposed to the template. */
  readonly dayOfWeek = dayOfWeek;
  readonly formatDateWithDow = formatDateWithDow;

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
}

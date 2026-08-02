import { Injectable, signal, computed, type Signal } from '@angular/core';

/** A single search match within the content viewer. */
export interface Occurrence {
  /** Zero-based line index in the displayed content. */
  lineIndex: number;
  /** Character offset within the line where the match starts. */
  charOffset: number;
  /** Length of the matched term. */
  length: number;
}

/** Bucket identifier for distinguishing corpus vs time-series search state. */
export type SearchBucket = 'corpus' | 'ts';

/** Internal state for a single search bucket. */
interface BucketSearchState {
  occurrences: Occurrence[];
  currentIndex: number;
}

const EMPTY_STATE: BucketSearchState = { occurrences: [], currentIndex: -1 };

/**
 * Shared service for in-content search across both viewer columns.
 *
 * The parent layout component owns the find bar UI and calls `setSearchTerm()`.
 * Each sub-component registers its content via `registerContent()` and watches
 * the current index signal to scroll its `<pre>` element.
 */
@Injectable({ providedIn: 'root' })
export class ContentSearchService {
  /** Current search term (case-insensitive). */
  readonly searchTerm = signal('');

  /** Unified state for both buckets — eliminates parallel signal duplication. */
  private readonly _bucketStates = signal<Record<SearchBucket, BucketSearchState>>({
    corpus: { ...EMPTY_STATE },
    ts: { ...EMPTY_STATE },
  });

  /** Current corpus occurrence position (1-based for display, 0 when empty). */
  readonly corpusCurrent = this.bucketComputed('corpus', (s) =>
    s.occurrences.length === 0 ? 0 : s.currentIndex + 1,
  );
  /** Total corpus occurrences. */
  readonly corpusTotal = this.bucketComputed('corpus', (s) => s.occurrences.length);
  /** 0-based corpus occurrence index (for selecting a specific <mark> element). */
  readonly corpusCurrentIndex = this.bucketComputed('corpus', (s) => s.currentIndex);

  /** Current time-series occurrence position (1-based for display, 0 when empty). */
  readonly tsCurrent = this.bucketComputed('ts', (s) =>
    s.occurrences.length === 0 ? 0 : s.currentIndex + 1,
  );
  /** Total time-series occurrences. */
  readonly tsTotal = this.bucketComputed('ts', (s) => s.occurrences.length);

  /** 0-based time-series occurrence index (for selecting a specific <mark> element). */
  readonly tsCurrentIndex = this.bucketComputed('ts', (s) => s.currentIndex);

  /** Update the search term. Does not recompute occurrences (sub-components do that). */
  setSearchTerm(term: string): void {
    this.searchTerm.set(term);
  }

  /**
   * Register content for a bucket and recompute occurrences based on the current search term.
   * Called by sub-components via effect when their displayed content changes.
   */
  registerContent(bucket: SearchBucket, content: string): void {
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) {
      this.setBucketState(bucket, EMPTY_STATE);
      return;
    }

    const occurrences = this.computeOccurrences(content, term);
    this.setBucketState(bucket, {
      occurrences,
      currentIndex: occurrences.length > 0 ? 0 : -1,
    });
  }

  /** Move to the next occurrence (with wraparound). */
  next(bucket: SearchBucket): void {
    this.step(bucket, 1);
  }

  /** Move to the previous occurrence (with wraparound). */
  prev(bucket: SearchBucket): void {
    this.step(bucket, -1);
  }

  /** Clear all search state for a bucket (called when content is cleared). */
  clearBucket(bucket: SearchBucket): void {
    this.setBucketState(bucket, EMPTY_STATE);
  }

  // --- Private helpers ---

  /** Create a computed signal derived from a single bucket's state. */
  private bucketComputed<T>(bucket: SearchBucket, fn: (state: BucketSearchState) => T): Signal<T> {
    return computed(() => fn(this._bucketStates()[bucket]));
  }

  /** Update one bucket's state immutably. */
  private setBucketState(bucket: SearchBucket, state: BucketSearchState): void {
    this._bucketStates.update((states) => ({ ...states, [bucket]: state }));
  }

  /** Advance the current index for a bucket with wraparound. */
  private step(bucket: SearchBucket, direction: 1 | -1): void {
    const state = this._bucketStates()[bucket];
    if (state.occurrences.length === 0) return;

    let next = state.currentIndex + direction;
    if (next >= state.occurrences.length) next = 0;
    if (next < 0) next = state.occurrences.length - 1;

    this.setBucketState(bucket, { ...state, currentIndex: next });
  }

  /**
   * Scan content line-by-line for case-insensitive matches of the search term.
   * # Reason: Line-based matching enables scroll-to-line behavior in the `<pre>` element.
   */
  private computeOccurrences(content: string, term: string): Occurrence[] {
    const occurrences: Occurrence[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toLowerCase();
      let offset = 0;
      while (offset <= line.length - term.length) {
        const found = line.indexOf(term, offset);
        if (found === -1) break;
        occurrences.push({ lineIndex: i, charOffset: found, length: term.length });
        offset = found + 1;
      }
    }

    return occurrences;
  }
}

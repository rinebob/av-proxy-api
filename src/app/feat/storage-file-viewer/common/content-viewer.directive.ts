import { Directive, ElementRef, inject, input, computed, effect, OnDestroy } from '@angular/core';

import { ContentSearchService, type SearchBucket } from './content-search.service';
import { formatContent, highlightContent } from './viewer-utils';

/**
 * Directive that manages a `<pre>` content viewer element.
 *
 * Handles:
 * - Pretty-printing raw content via `formatContent`.
 * - Highlighting search matches via `highlightContent` (XSS-safe HTML escaping).
 * - Registering content with `ContentSearchService` for occurrence tracking.
 * - Scrolling to the current search occurrence using `getComputedStyle`.
 *
 * # Reason: Extracts duplicated logic from `CorpusViewerComponent` and
 * `TimeSeriesViewerComponent` into a single reusable directive.
 */
@Directive({
  selector: 'pre[appContentViewer]',
  standalone: true,
})
export class ContentViewerDirective implements OnDestroy {
  private readonly searchService = inject(ContentSearchService);
  private readonly el = inject<ElementRef<HTMLPreElement>>(ElementRef);

  /** Bucket identifier for search state tracking. */
  readonly bucket = input.required<SearchBucket>();

  /** Raw content string to format and display. */
  readonly content = input.required<string>();

  /** Pretty-printed content (JSONL → indented JSON). */
  private readonly formattedContent = computed(() => {
    const raw = this.content();
    return raw ? formatContent(raw) : '';
  });

  /**
   * Current occurrence for this bucket, selected dynamically based on the `bucket` input.
   * # Reason: Computed tracks both the bucket input and the service's per-bucket signals.
   */
  private readonly currentOccurrence = computed(() => {
    const bucket = this.bucket();
    return bucket === 'corpus'
      ? this.searchService.corpusCurrentOccurrence()
      : this.searchService.tsCurrentOccurrence();
  });

  constructor() {
    // # Reason: Update innerHTML when content or search term changes.
    // highlightContent calls escapeHtml first, which escapes all HTML entities,
    // then wraps search matches in <mark> tags. This makes the output XSS-safe.
    effect(() => {
      const html = highlightContent(this.formattedContent(), this.searchService.searchTerm());
      this.el.nativeElement.innerHTML = html;
    });

    // # Reason: Register/clear content with the search service when it changes.
    effect(() => {
      const content = this.formattedContent();
      if (content) {
        this.searchService.registerContent(this.bucket(), content);
      } else {
        this.searchService.clearBucket(this.bucket());
      }
    });

    // # Reason: Scroll to the current search occurrence when the index changes.
    effect(() => {
      const occurrence = this.currentOccurrence();
      if (occurrence) {
        this.scrollToOccurrence(occurrence.lineIndex);
      }
    });
  }

  ngOnDestroy(): void {
    this.searchService.clearBucket(this.bucket());
  }

  /**
   * Scroll the `<pre>` element to bring the given line index into view.
   * # Reason: Uses `getComputedStyle` to read the actual line height from CSS,
   * avoiding a hardcoded magic number that would break if font-size or line-height changes.
   */
  private scrollToOccurrence(lineIndex: number): void {
    const pre = this.el.nativeElement;
    const lineHeight = parseFloat(getComputedStyle(pre).lineHeight);
    pre.scrollTop = lineIndex * (isNaN(lineHeight) ? 19.2 : lineHeight);
  }
}

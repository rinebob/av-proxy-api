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
 * - Scrolling to the current search occurrence using `scrollIntoView` on `<mark>` elements.
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
   * Current 0-based occurrence index for this bucket.
   * # Reason: Used to select the Nth `<mark>` element in the DOM for scrollIntoView.
   */
  private readonly currentIndex = computed(() => {
    const bucket = this.bucket();
    return bucket === 'corpus'
      ? this.searchService.corpusCurrentIndex()
      : this.searchService.tsCurrentIndex();
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
    // Uses the actual <mark> element's scrollIntoView instead of a mathematical
    // pixel calculation, which breaks when lines wrap due to pre-wrap + word-break.
    effect(() => {
      const index = this.currentIndex();
      if (index < 0) return;
      // # Reason: querySelectorAll is live at this point because the innerHTML
      // effect runs first (it's declared above). Angular effects run in order.
      const marks = this.el.nativeElement.querySelectorAll('mark.search-hit');
      if (index < marks.length) {
        marks[index].scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    });
  }

  ngOnDestroy(): void {
    this.searchService.clearBucket(this.bucket());
  }
}

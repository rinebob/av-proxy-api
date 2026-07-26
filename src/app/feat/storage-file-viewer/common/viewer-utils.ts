/**
 * Shared pure utility functions for the Storage File Viewer components.
 * Extracted from `StorageViewerComponent` to allow reuse across
 * `CorpusViewerComponent` and `TimeSeriesViewerComponent`.
 */

/** Intl number formatter for strike prices (USD, up to 3 decimal places). */
const STRIKE_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

/**
 * Format a strike value as a USD currency string.
 * @param strike - The strike price to format.
 * @returns Formatted string, e.g. "$450" or "$128.50".
 */
export function formatStrike(strike: number): string {
  return STRIKE_FORMATTER.format(strike);
}

/**
 * Format a byte count into a human-readable string with appropriate units.
 * @param bytes - The number of bytes.
 * @returns Formatted string, e.g. "512 B", "12.3 KB", "4.56 MB".
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Pretty-print JSONL content: parse each line as JSON and format with indentation.
 * Falls back to single-object JSON parsing, then raw content if parsing fails.
 * @param content - Raw file content string (JSONL or JSON).
 * @returns Pretty-printed JSON string.
 */
export function formatContent(content: string): string {
  const lines = content.split('\n').filter((l) => l.trim());
  if (lines.length === 0) return content;

  try {
    const parsed = lines.map((line) => JSON.parse(line));
    return JSON.stringify(parsed, null, 2);
  } catch {
    // # Reason: Content may be a single JSON object rather than JSONL.
    try {
      return JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      // # Reason: Content is not valid JSON — display as-is.
      return content;
    }
  }
}

/**
 * Escape HTML special characters to prevent XSS when using innerHTML.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Produce safe HTML from content with search term matches wrapped in `<mark>` tags.
 *
 * # Reason: The content is displayed via [innerHTML], so we must escape HTML entities
 * first to prevent XSS, then wrap matches in highlight markers.
 *
 * @param content - The already-formatted (pretty-printed) content string.
 * @param searchTerm - The raw search term (case-insensitive matching).
 * @returns HTML-escaped string with `<mark class="search-hit">` around matches.
 */
export function highlightContent(content: string, searchTerm: string): string {
  const escaped = escapeHtml(content);
  const term = searchTerm.trim();
  if (!term) return escaped;

  // # Reason: Escape the search term too, then build a case-insensitive regex
  // that matches the escaped version so special regex chars don't break matching.
  const escapedTerm = escapeHtml(term);
  const escapedPattern = escapedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedPattern})`, 'gi');
  return escaped.replace(regex, '<mark class="search-hit">$1</mark>');
}

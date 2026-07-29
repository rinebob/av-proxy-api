/**
 * Shared constants used across both the Angular client and Cloud Functions backend.
 */

/**
 * The set of ticker symbols supported by the options time-series partner endpoints.
 * Both the partner handler layer and the spread-pricing validation layer reference this.
 */
export const ALLOWED_SYMBOLS = new Set(['QQQ', 'TQQQ']);

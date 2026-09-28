/**
 * Shared constants used across both the Angular client and Cloud Functions backend.
 */

/**
 * The QQQ/TQQQ pilot universe for the spread-pricing endpoints
 * (`partnerSpreadTimeSeries` / `partnerSpreadTimeSeriesBatch`) — spread data is
 * only computed for these pairs.
 *
 * Scope note: this is NOT the options-corpus gate. Options-data partner
 * endpoints serve exactly the Firestore `optionsEnabled` set (Task #150) —
 * there is no static options allowlist.
 */
export const ALLOWED_SYMBOLS = new Set(['QQQ', 'TQQQ']);

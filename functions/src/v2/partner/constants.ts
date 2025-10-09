/**
 * Shared constants for Partner data-ready publishing/subscribing.
 */

/** Audit-only email used when this service publishes internally.
 * Appears under partnerEvents/{runId}.auth.email for provenance.
 */
export const INTERNAL_PUBLISHER_AUDIT_EMAIL = 'av-refresh-manager@alpha-vantage-proxy-api.internal';

/** Pub/Sub topic for partner data-ready notifications. */
export const PARTNER_DATA_READY_TOPIC = 'partner-data-ready';

/**
 * PartnerPhase: canonical enum for pre/post trading phases.
 * Prefer using this enum over raw string literals.
 */
export enum PartnerPhase {
  PRE = 'pre',
  POST = 'post',
}

/**
 * PartnerRunType: classifies the refresher run intent for consumers.
 * - NON_TIME_SERIES: generic non-time-series refresh cycle
 * - TS_DAILY_PRE: pre-close daily time-series snapshot writes
 * - TS_DAILY_POST: post-close daily time-series finalized writes
 * - TS_WEEKLY_POST: post-close weekly time-series writes
 * - TS_MONTHLY_POST: post-close monthly time-series writes
 */
export enum PartnerRunType {
  NON_TIME_SERIES = 'non_time_series',
  TS_DAILY_PRE = 'ts_daily_pre',
  TS_DAILY_POST = 'ts_daily_post',
  TS_WEEKLY_POST = 'ts_weekly_post',
  TS_MONTHLY_POST = 'ts_monthly_post',
}

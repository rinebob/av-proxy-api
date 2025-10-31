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
 * Now uses kebab-case to match RS V2 subscriber expectations.
 * - non-time-series
 * - ts-daily-pre
 * - ts-daily-post
 * - ts-weekly-post
 * - ts-monthly-post
 */
export enum PartnerRunType {
  NON_TIME_SERIES = 'non-time-series',
  TS_DAILY_PRE = 'ts-daily-pre',
  TS_DAILY_POST = 'ts-daily-post',
  TS_WEEKLY_POST = 'ts-weekly-post',
  TS_MONTHLY_POST = 'ts-monthly-post',
}

/**
 * PartnerTrigger: origin of the partner data-ready message.
 * - MANUAL: initiated by a human or explicit test trigger
 * - SCHEDULED: initiated by a scheduled refresher run
 * - HEARTBEAT: emitted by the heartbeat publisher for connectivity testing
 */
export enum PartnerTrigger {
  MANUAL = 'manual',
  SCHEDULED = 'scheduled',
  HEARTBEAT = 'heartbeat',
}

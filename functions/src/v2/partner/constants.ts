/**
 * Shared constants for Partner data-ready publishing/subscribing.
 */

/** Audit-only email used when this service publishes internally.
 * Appears under partnerEvents/{runId}.auth.email for provenance.
 */
export const INTERNAL_PUBLISHER_AUDIT_EMAIL = 'av-refresh-manager@alpha-vantage-proxy-api.internal';

/** Pub/Sub topic for partner data-ready notifications. */
export const PARTNER_DATA_READY_TOPIC = 'partner-data-ready';

/** Pub/Sub topic for symbol-level readiness notifications. */
export const PARTNER_SYMBOLS_READY_TOPIC = 'partner-symbols-ready';

/** Pub/Sub topic for tracked-symbol onboarding lifecycle events. */
export const PARTNER_SYMBOL_ADDED_TOPIC = 'partner-symbol-added';

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
 * - intraday-snapshot
 */
export enum PartnerRunType {
  NON_TIME_SERIES = 'non-time-series',
  TS_DAILY_PRE = 'ts-daily-pre',
  TS_DAILY_POST = 'ts-daily-post',
  TS_WEEKLY_POST = 'ts-weekly-post',
  TS_MONTHLY_POST = 'ts-monthly-post',
  /**
   * TS_POST_ALL_INTERVALS represents a single universe-level
   * time-series POST run that has completed DAILY, WEEKLY, and
   * MONTHLY intervals for a given marketDate.
   */
  TS_POST_ALL_INTERVALS = 'ts-post-all-intervals',
  /**
   * INTRADAY_SNAPSHOT represents hourly intraday snapshot runs
   * that provide fresh ip/ipc/io/it/ic data for consumption by
   * partner systems (e.g., RS intraday data feed).
   */
  INTRADAY_SNAPSHOT = 'intraday-snapshot',
}

/**
 * PartnerTrigger: origin of the partner data-ready message.
 * - MANUAL: initiated by a human or explicit ad-hoc trigger
 * - SCHEDULED: initiated by a scheduled refresher run
 * - HEARTBEAT: emitted by the heartbeat publisher for connectivity testing
 * - TEST: emitted when we want downstream consumers (e.g. RS) to receive but
 *         deliberately skip normal processing of the message.
 */
export enum PartnerTrigger {
  MANUAL = 'manual',
  SCHEDULED = 'scheduled',
  HEARTBEAT = 'heartbeat',
  TEST = 'test',
}

/**
 * Canonical runStatus values for partner data-ready payloads.
 */
export enum PartnerRunStatus {
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  COMPLETED_WITH_ERRORS = 'completed_with_errors',
  FAILED = 'failed',
}

/**
 * Advisory flags for partner payloads.
 */
export enum PartnerAdvisory {
  NEAR_COMPLETE = 'near_complete',
}

/**
 * Publish status for partner messages.
 */
export enum PartnerPublishStatus {
  BEGIN = 'begin',
  END = 'end',
}

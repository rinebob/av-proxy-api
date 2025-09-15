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

/**
 * Canonical ops-alert event — the single emission seam for operator SMS
 * notifications (Topic #198). Pipeline code and watchdogs emit this event;
 * composition happens upstream (composer), delivery downstream (sender).
 */

/** Routine signoff vs hard-down exception. */
export type OpsAlertKind = 'signoff' | 'exception';

/**
 * A fully composed operator alert.
 *
 * `alertKey` is the dedupe/audit identity — unique per (run, condition),
 * e.g. 'signoff:post-a:2026-10-23' or 'exception:intraday:2026-10-23:0800:pdr_missing'.
 * Re-emitting the same alertKey overwrites the audit doc rather than
 * duplicating it.
 */
export interface OpsAlertEvent {
  /** Deterministic audit/dedupe key — becomes the audit doc id. */
  alertKey: string;
  /** 'signoff' for routine run-completion texts; 'exception' for hard-down conditions. */
  kind: OpsAlertKind;
  /** The final human-readable SMS body (composed upstream). */
  smsText: string;
  /** Run document id this alert pertains to, when applicable. */
  runId?: string;
  /** Market date (YYYY-MM-DD, PT) for the run/tick. */
  marketDate?: string;
  /** Structured context for observability (counts, intervals, tick, condition). */
  context?: Record<string, unknown>;
}

/**
 * alertKey validity — non-empty and free of '/', since it becomes a
 * Firestore document id (audit doc, claim doc). Shared by the emitter and
 * the send-once guard.
 */
export function isValidAlertKey(alertKey: string | undefined | null): alertKey is string {
  return !!alertKey && !alertKey.includes('/');
}

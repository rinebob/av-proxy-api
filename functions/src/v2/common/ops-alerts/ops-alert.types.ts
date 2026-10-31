/**
 * Canonical ops-alert event — the single emission seam for operator SMS
 * notifications (Topic #198). Pipeline code and watchdogs emit this event;
 * composition happens upstream (composer), delivery downstream (sender).
 */

import type { OpsExceptionCondition } from './ops-alert.composer';

/** Routine signoff vs hard-down exception. */
export type OpsAlertKind = 'signoff' | 'exception';

/**
 * A fully composed operator alert.
 *
 * `alertKey` is the dedupe/audit identity — unique per (run, condition),
 * e.g. 'signoff:post:2026-10-23:A' or 'exception:intraday:2026-10-23:0800:pdr_missing'.
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

/**
 * Canonical alertKey builders for exception events — the single source
 * of truth for exception key formats so watchdogs, tests, and verify
 * scripts can't drift on casing or segment order. Interval segments use
 * the enum (lowercase) vocabulary; condition segments are lowercase
 * snake_case. Signoff keys are still built at their call sites
 * (intraday-ops-signoff / post-ops-signoff) — add builders here if a
 * third signoff key site ever appears.
 */
export const opsAlertKey = {
  /**
   * Intraday hard-down exception:
   * 'exception:intraday:{marketDate}:{clockPt}:{condition}'
   */
  exceptionIntraday(
    marketDate: string,
    clockPt: string,
    condition: OpsExceptionCondition,
  ): string {
    return `exception:intraday:${marketDate}:${clockPt}:${condition}`;
  },
  /**
   * POST hard-down exception:
   * 'exception:post:{marketDate}:{sequence}:{interval}:{condition}'
   */
  exceptionPost(
    marketDate: string,
    sequence: string,
    interval: string,
    condition: OpsExceptionCondition,
  ): string {
    return `exception:post:${marketDate}:${sequence}:${interval}:${condition}`;
  },
} as const;

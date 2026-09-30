/**
 * Core of the setOptionsEnabledV2 curation callable (Thread #105 §70).
 *
 * The guarded toggle: enabling requires `optionable===true` (else
 * OPTIONS_NOT_OPTIONABLE — you can't enable what doesn't have options).
 * Every transition appends an audit entry {enabled, changedBy, changedAt,
 * reason?} to optionsEnabledHistory and bumps _lastUpdated. Swing-set
 * generation enqueues ONLY on false→true — the downstream of the flag —
 * and an enqueue failure warns rather than failing the write (the sweep
 * covers missed signals).
 *
 * Idempotent: setting the flag to its current value is a no-op — no
 * history entry, no enqueue.
 */
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

import { FirestoreCollection } from '@shared/firestore';
import {
  TRACKED_SYMBOL_V2_FIELDS as F,
  SetOptionsEnabledErrorCode,
  type SetOptionsEnabledRequest,
  type SetOptionsEnabledResult,
} from '@shared/alpha-vantage';
import type { FirestoreLike } from '../../common/firestore/firestore-like';

export { SetOptionsEnabledErrorCode };
export type { SetOptionsEnabledRequest, SetOptionsEnabledResult };

/** Internal request — the callable request plus the authenticated uid. */
export interface SetOptionsEnabledInternalRequest extends SetOptionsEnabledRequest {
  /** Authenticated caller uid (from request.auth) — recorded as changedBy. */
  uid: string;
}

export interface SetOptionsEnabledDeps {
  db: FirestoreLike;
  /** enqueueSwingSetGeneration bound to its deps — called only on false→true. */
  enqueue(symbol: string): Promise<unknown>;
  /**
   * Pivot-seed fanout (Task #153) — enqueues Stage-1 corpus seed tasks for
   * every planned pivot date. Called only on false→true; a no-op when the
   * swing doc doesn't exist yet (first enable: generation fires the fanout
   * on completion instead).
   */
  seedCorpus?(symbol: string): Promise<unknown>;
  /**
   * Called only on true→false (Task #188): deletes `iv-rank-latest/{SYM}` so
   * a disabled symbol never lingers in the partnerIvRankV2 screener table.
   * Warn-swallowed like the enable-side callbacks.
   */
  onDisable?(symbol: string): Promise<unknown>;
  logger: { info(m: string): void; warn(m: string): void };
}

export async function handleSetOptionsEnabled(
  req: SetOptionsEnabledInternalRequest,
  deps: SetOptionsEnabledDeps,
): Promise<SetOptionsEnabledResult> {
  const symbol = String(req.symbol ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.-]{0,31}$/.test(symbol)) {
    return {
      ok: false,
      symbol,
      transitioned: false,
      errorCode: SetOptionsEnabledErrorCode.INVALID_ARGUMENT,
      error: 'Symbol is required and must be valid.',
    };
  }
  const ref = deps.db.collection(FirestoreCollection.TRACKED_SYMBOLS).doc(symbol);
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, symbol, transitioned: false, errorCode: SetOptionsEnabledErrorCode.SYMBOL_NOT_FOUND, error: `Symbol ${symbol} is not tracked.` };
  }

  const doc = snap.data() as Record<string, unknown>;
  const current = doc[F.OPTIONS_ENABLED] === true;

  if (req.enabled === current) {
    return { ok: true, symbol, transitioned: false, optionsEnabled: current };
  }

  // Enabling a symbol that doesn't have a listed options chain is a
  // precondition failure — the corpus pipeline would find nothing.
  if (req.enabled && doc[F.OPTIONABLE] !== true) {
    // Distinguish "genuinely no options" from "the probe itself failed" —
    // a failed probe also leaves optionable=false, with optionableProbeError
    // recording why.
    const probeError = typeof doc[F.OPTIONABLE_PROBE_ERROR] === 'string' ? ` (probe error: ${doc[F.OPTIONABLE_PROBE_ERROR]})` : '';
    return {
      ok: false, symbol, transitioned: false,
      errorCode: SetOptionsEnabledErrorCode.OPTIONS_NOT_OPTIONABLE,
      error: `Symbol ${symbol} is not optionable (optionable=${doc[F.OPTIONABLE] ?? 'absent'})${probeError}.`,
    };
  }

  const entry: Record<string, unknown> = {
    enabled: req.enabled,
    changedBy: req.uid,
    changedAt: Timestamp.now(),
  };
  if (req.reason !== undefined) entry.reason = req.reason;

  await ref.set(
    {
      [F.OPTIONS_ENABLED]: req.enabled,
      [F.OPTIONS_ENABLED_HISTORY]: FieldValue.arrayUnion(entry),
      [F.LAST_UPDATED]: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  deps.logger.info(`setOptionsEnabledV2: ${symbol} ${current}→${req.enabled} by ${req.uid}`);

  // Downstream of the flag: kick swing-set generation + pivot-seed fanout
  // only on the enabling transition. Failures warn — the sweep catches
  // missed signals.
  if (req.enabled === true && current === false) {
    try {
      await deps.enqueue(symbol);
    } catch (e) {
      deps.logger.warn(`setOptionsEnabledV2: swing-set enqueue failed for ${symbol} — ${e instanceof Error ? e.message : String(e)}`);
    }
    if (deps.seedCorpus) {
      try {
        await deps.seedCorpus(symbol);
      } catch (e) {
        deps.logger.warn(`setOptionsEnabledV2: corpus seed fanout failed for ${symbol} — ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // Disabling: drop the symbol's screener doc — stale rows must never
  // linger in iv-rank-latest (partnerIvRankV2 reads it wholesale).
  if (req.enabled === false && current === true && deps.onDisable) {
    try {
      await deps.onDisable(symbol);
      deps.logger.info(`setOptionsEnabledV2: disabled-symbol cleanup ran for ${symbol}`);
    } catch (e) {
      deps.logger.warn(`setOptionsEnabledV2: disabled-symbol cleanup failed for ${symbol} — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { ok: true, symbol, transitioned: true, optionsEnabled: req.enabled };
}

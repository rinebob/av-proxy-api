/**
 * setOptionsEnabledV2 — the dedicated curation callable for the
 * optionsEnabled flag (Thread #105). Auth required (same convention as
 * saveTrackedSymbol). Args {symbol, enabled, reason?} → all validation,
 * the optionable gate, audit history, and the false→true swing-set
 * enqueue live in set-options-enabled.core.ts (side-effect-free).
 *
 * Admin-only in practice: the app's only user is the operator; any
 * authenticated caller could technically invoke it — a custom-claim check
 * can be added here if a second user role ever appears.
 */
import { db } from '../../../firebase-admin-init';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { SetOptionsEnabledErrorCode, type SetOptionsEnabledResult } from '@shared/alpha-vantage';
import { enqueueSwingSetGeneration } from '../../swing-set/handlers/generate-swing-sets.core';
import { fanoutPivotSeedsForSymbol } from '../../historical-options-corpus/services/pivot-seed-fanout';
import { ALLOWED_ORIGINS } from '../../utils/cors-middleware';
import { IvRankLatestRepository } from '../../symbol-metrics/services/iv-rank-latest.repository';
import { handleSetOptionsEnabled } from './set-options-enabled.core';
import { toSetOptionsEnabledHttpsError } from './set-options-enabled.errors';

export const setOptionsEnabledV2 = onCall<{ symbol?: string; enabled?: boolean; reason?: string }, Promise<SetOptionsEnabledResult>>(
  { cors: ALLOWED_ORIGINS },
  async (request) => {
    const symbol = String(request.data?.symbol ?? '').trim().toUpperCase();

    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Unauthenticated', {
        errorCode: SetOptionsEnabledErrorCode.UNAUTHENTICATED,
      });
    }
    if (!symbol || !/^[A-Z0-9][A-Z0-9.-]{0,31}$/.test(symbol)) {
      throw new HttpsError('invalid-argument', 'symbol is required and must be valid', {
        errorCode: SetOptionsEnabledErrorCode.INVALID_ARGUMENT,
      });
    }
    if (typeof request.data?.enabled !== 'boolean') {
      throw new HttpsError('invalid-argument', 'enabled must be a boolean', {
        errorCode: SetOptionsEnabledErrorCode.INVALID_ARGUMENT,
      });
    }
    if (request.data.reason !== undefined && typeof request.data.reason !== 'string') {
      throw new HttpsError('invalid-argument', 'reason must be a string', {
        errorCode: SetOptionsEnabledErrorCode.INVALID_ARGUMENT,
      });
    }

    const result = await handleSetOptionsEnabled(
      { symbol, enabled: request.data.enabled, reason: request.data.reason, uid: request.auth.uid },
      {
        db,
        enqueue: (s) => enqueueSwingSetGeneration(db, s),
        seedCorpus: fanoutPivotSeedsForSymbol,
        onDisable: (s) => new IvRankLatestRepository(db).delete(s),
        logger: console,
      },
    );
    if (!result.ok) throw toSetOptionsEnabledHttpsError(result);
    return result;
  },
);

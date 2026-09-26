/**
 * backfillSwingSets — operator-run HTTP backfill (Task #127).
 *
 * Generates swing files for all options-enabled symbols (or a named subset,
 * still gated on optionsEnabled). Idempotent — safe to re-run; freshness
 * still applies unless force=true.
 *
 * POST body (all optional):
 * - symbols: string[] or comma-separated; defaults to all options-enabled
 *   (an explicit empty list sweeps nothing)
 * - force: boolean; default false — true regenerates even fresh docs
 * - dryRun: boolean; default false — true reports wouldGenerate (no writes)
 *
 * Requires `x-admin-secret` matching SWING_SET_ADMIN_SECRET (same convention
 * as triggerHistoricalOptionsPilot).
 */
import { defineSecret } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import type { Request, Response } from 'express';

import { admin } from '../../../firebase-admin-init';
import { normalizeSymbolList, requireAdminSecret } from '../../common/http-admin';
import { withCors } from '../../utils/cors-middleware';
import { DailyAdjustedReader } from '../services/daily-adjusted-reader.service';
import { SwingSetRepository } from '../services/swing-set.repository';
import { SwingSetGenerationService } from '../services/swing-set-generation.service';
import { fanoutPivotSeedsForSymbol } from '../../historical-options-corpus/services/pivot-seed-fanout';
import { runSwingSetSweep } from './swing-set-sweep.core';

const swingSetAdminSecret = defineSecret('SWING_SET_ADMIN_SECRET');

interface BackfillBody {
  symbols?: string[] | string;
  force?: boolean;
  dryRun?: boolean;
}

export const backfillSwingSets = onRequest(
  {
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: [swingSetAdminSecret],
  },
  withCors(async (req: Request, res: Response) => {
    try {
      if (req.method !== 'POST') {
        res.status(405).json({ ok: false, error: 'Method not allowed; use POST' });
        return;
      }
      if (!requireAdminSecret(req, res, swingSetAdminSecret)) return;

      const body = (req.body || {}) as BackfillBody;
      const symbols = normalizeSymbolList(body.symbols);
      const force = body.force === true;
      const dryRun = body.dryRun === true;

      console.log('[backfillSwingSets] start', { symbols, force, dryRun });

      const db = admin.firestore();
      const repository = new SwingSetRepository(db);
      const report = await runSwingSetSweep(db, {
        repository,
        generation: new SwingSetGenerationService(new DailyAdjustedReader(db), repository, console),
        logger: console,
        onGenerated: fanoutPivotSeedsForSymbol,
        symbols,
        force,
        dryRun,
      });

      console.log('[backfillSwingSets] done', report);
      res.status(200).json({ ok: true, dryRun, report });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[backfillSwingSets] error', { error: msg });
      res.status(500).json({ ok: false, error: msg });
    }
  }),
);

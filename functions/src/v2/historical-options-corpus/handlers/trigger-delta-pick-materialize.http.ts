import { defineSecret } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import { getFunctions } from 'firebase-admin/functions';
import type { Request, Response } from 'express';

import { createLogger } from '../../utils/utils';
import { withCors } from '../../utils/cors-middleware';
import { createOptionsEnabledChecker, listOptionsEnabledSymbols } from '../services/options-enabled-gate';
import { isValidIsoDate } from '../../common/utils/date-time.utils';
import { OPTIONS_PICK_MATERIALIZE_TASK_QUEUE, type PickMaterializePayload } from './pick-materialize.task';

const logger = createLogger('delta-pick-materialize-trigger');
const pickMaterializeAdminSecret = defineSecret('HISTORICAL_OPTIONS_PICK_MATERIALIZE_ADMIN_SECRET');

interface TriggerPickMaterializeBody {
  /** Single symbol to materialize, e.g. 'QQQ'. Required unless allSymbols. */
  symbol?: string;
  /** Enqueue one materialization task per options-enabled symbol. */
  allSymbols?: boolean;
  /** Optional single-date bound — the task materializes only this date. */
  date?: string;
}

function isAdmin(req: Request): boolean {
  const expectedSecret = String(pickMaterializeAdminSecret.value() || '').trim();
  const providedSecret = String(req.headers['x-admin-secret'] || '').trim();

  return !!(expectedSecret && providedSecret && expectedSecret === providedSecret);
}

/**
 * Ops trigger for delta-pick materialization (Thread #214 / Task #223).
 *
 * POST body:
 * - symbol: enqueue one task for that symbol's whole stored corpus
 * - allSymbols: enqueue one task per options-enabled symbol (~130 tasks)
 * - date: optional 'YYYY-MM-DD' bound — enqueues {symbol, date} instead
 *
 * Every enqueue is a GCS-reads-only worker — zero AV calls. Requires
 * `x-admin-secret` matching HISTORICAL_OPTIONS_PICK_MATERIALIZE_ADMIN_SECRET.
 */
export const triggerDeltaPickMaterialize = onRequest(
  {
    timeoutSeconds: 300,
    memory: '512MiB',
    secrets: [pickMaterializeAdminSecret],
  },
  withCors(async (req: Request, res: Response) => {
    try {
      if (req.method !== 'POST') {
        res.status(405).json({ ok: false, error: 'Method not allowed; use POST' });
        return;
      }

      if (!isAdmin(req)) {
        res.status(403).json({ ok: false, error: 'Forbidden' });
        return;
      }

      const body = (req.body || {}) as TriggerPickMaterializeBody;
      const symbol = typeof body.symbol === 'string' ? body.symbol.trim().toUpperCase() : '';
      const allSymbols = body.allSymbols === true;
      const dateRaw = typeof body.date === 'string' ? body.date.trim() : '';
      const date = isValidIsoDate(dateRaw) ? dateRaw : undefined;

      // Any provided-but-unusable date rejects — never silently widen a
      // bounded run into a full-corpus one.
      if (body.date !== undefined && date === undefined) {
        res.status(400).json({ ok: false, error: 'Malformed date — expected YYYY-MM-DD' });
        return;
      }

      if (!symbol && !allSymbols) {
        res.status(400).json({ ok: false, error: 'Missing required symbol (or set allSymbols)' });
        return;
      }
      if (allSymbols && date !== undefined) {
        res.status(400).json({ ok: false, error: 'date bound requires an explicit symbol' });
        return;
      }

      const queue = getFunctions().taskQueue<PickMaterializePayload>(OPTIONS_PICK_MATERIALIZE_TASK_QUEUE);

      if (allSymbols) {
        const symbols = await listOptionsEnabledSymbols();
        await Promise.all(symbols.map((s) => queue.enqueue({ symbol: s })));
        logger.info('trigger_pick_materialize.enqueued_all', { count: symbols.length });
        res.status(200).json({ ok: true, enqueued: symbols.length, symbols });
        return;
      }

      if (!(await createOptionsEnabledChecker()(symbol))) {
        res.status(200).json({ ok: false, skipped: true, reason: 'options-disabled', symbol });
        return;
      }

      await queue.enqueue(date === undefined ? { symbol } : { symbol, date });
      logger.info('trigger_pick_materialize.enqueued', { symbol, date });
      res.status(200).json({ ok: true, enqueued: 1, symbol, date });
    } catch (error: any) {
      const msg = String(error?.message || error);
      logger.error('trigger_pick_materialize.error', { error: msg });
      res.status(500).json({ ok: false, error: msg });
    }
  }),
);

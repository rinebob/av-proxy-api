import { onRequest } from 'firebase-functions/v2/https';
import type { Request, Response } from 'express';

import { createLogger } from '../../utils/utils';
import { withCors } from '../../utils/cors-middleware';
import {
  createHistoricalOptionsPilotService,
  DEFAULT_PILOT_MAX_TRADING_DATES,
  DEFAULT_PILOT_START_DATE,
  DEFAULT_PILOT_SYMBOLS,
  type PilotOptions,
} from '../services/pilot.service';

const logger = createLogger('historical-options-pilot-trigger');

interface TriggerHistoricalOptionsPilotBody {
  symbols?: string[] | string;
  startDate?: string;
  referenceDate?: string;
  maxTradingDatesPerSymbol?: number;
  dryRun?: boolean;
  execute?: boolean;
}

function normalizeSymbols(raw: unknown): string[] | undefined {
  if (Array.isArray(raw)) {
    return raw
      .map((s) => String(s).trim().toUpperCase())
      .filter(Boolean)
      .filter((s, i, arr) => arr.indexOf(s) === i);
  }
  if (typeof raw === 'string' && raw.trim()) {
    return raw
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .filter((s, i, arr) => arr.indexOf(s) === i);
  }
  return undefined;
}

function isValidIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isAdmin(req: Request, res: Response): boolean {
  const expectedSecret = String(process.env.HISTORICAL_OPTIONS_PILOT_ADMIN_SECRET || '').trim();
  const providedSecret = String(req.headers['x-admin-secret'] || '').trim();

  if (!expectedSecret || !providedSecret || expectedSecret !== providedSecret) {
    res.status(403).json({ ok: false, error: 'Forbidden' });
    return false;
  }

  return true;
}

/**
 * Admin HTTP trigger for the QQQ/TQQQ historical-options corpus pilot/backfill.
 *
 * POST body (all optional):
 * - symbols: string[] or comma-separated string; defaults to ['QQQ', 'TQQQ']
 * - startDate: 'YYYY-MM-DD'; defaults to '2019-01-01'
 * - referenceDate: 'YYYY-MM-DD'; defaults to yesterday in America/New_York
 * - maxTradingDatesPerSymbol: number; defaults to 20
 * - dryRun: boolean; defaults to true (plan/report only, no tasks enqueued)
 * - execute: boolean; defaults to false; must be true with dryRun=false to enqueue seed tasks
 *
 * Requires the `HISTORICAL_OPTIONS_PILOT_ADMIN_SECRET` env var and an
 * `x-admin-secret` header. This guard can be replaced with IAM/auth proxy later.
 */
export const triggerHistoricalOptionsPilot = onRequest(
  {
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  withCors(async (req: Request, res: Response) => {
    try {
      if (req.method !== 'POST') {
        res.status(405).json({ ok: false, error: 'Method not allowed; use POST' });
        return;
      }

      if (!isAdmin(req, res)) {
        return;
      }

      const body = (req.body || {}) as TriggerHistoricalOptionsPilotBody;

      const symbols = normalizeSymbols(body.symbols) ?? [...DEFAULT_PILOT_SYMBOLS];
      const startDate = isValidIsoDate(body.startDate) ? body.startDate : DEFAULT_PILOT_START_DATE;
      const referenceDate = isValidIsoDate(body.referenceDate) ? body.referenceDate : undefined;
      const maxTradingDatesPerSymbol =
        typeof body.maxTradingDatesPerSymbol === 'number' && body.maxTradingDatesPerSymbol > 0
          ? body.maxTradingDatesPerSymbol
          : DEFAULT_PILOT_MAX_TRADING_DATES;
      const dryRun = typeof body.dryRun === 'boolean' ? body.dryRun : true;
      const execute = typeof body.execute === 'boolean' ? body.execute : false;

      if (execute && dryRun) {
        res.status(400).json({
          ok: false,
          error: 'Cannot execute a dry run; set dryRun=false to dispatch seed tasks.',
        });
        return;
      }

      logger.info('trigger_pilot.start', {
        symbols,
        startDate,
        referenceDate,
        maxTradingDatesPerSymbol,
        dryRun,
        execute,
      });

      const service = createHistoricalOptionsPilotService();
      const report = await service.run({
        symbols,
        startDate,
        referenceDate,
        maxTradingDatesPerSymbol,
        dryRun,
        execute,
      } as PilotOptions);

      logger.info('trigger_pilot.success', {
        runId: report.runId,
        totalItems: report.totalItems,
        missingItems: report.missingItems,
        executed: report.executed,
      });

      res.status(report.executed ? 202 : 200).json({ ok: true, report });
    } catch (error: any) {
      const msg = String(error?.message || error);
      logger.error('trigger_pilot.error', { error: msg });
      res.status(500).json({ ok: false, error: msg });
    }
  }),
);

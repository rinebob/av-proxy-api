import { defineSecret } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import type { Request, Response } from 'express';

import { createLogger } from '../../utils/utils';
import { withCors } from '../../utils/cors-middleware';
import { createTimeSeriesBuilderService } from '../services/time-series-builder.service';
import { TradingCalendarService } from '../services/trading-calendar.service';
import { getYesterdayEt } from '../../common/utils/date-time.utils';

const logger = createLogger('historical-options-time-series-build-trigger');
const timeSeriesBuildAdminSecret = defineSecret('HISTORICAL_OPTIONS_TIME_SERIES_ADMIN_SECRET');

interface TriggerTimeSeriesBuildBody {
  symbol?: string;
  startDate?: string;
  endDate?: string;
  execute?: boolean;
}

function isValidIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isAdmin(req: Request): boolean {
  const expectedSecret = String(timeSeriesBuildAdminSecret.value() || '').trim();
  const providedSecret = String(req.headers['x-admin-secret'] || '').trim();

  return !!(expectedSecret && providedSecret && expectedSecret === providedSecret);
}

function buildPlan(
  calendar: TradingCalendarService,
  symbol: string,
  startDate: string,
  endDate: string,
): {
  symbol: string;
  startDate: string;
  endDate: string;
  totalTradingDays: number;
} {
  const tradingDays = calendar.getTradingDates(startDate, endDate);
  return {
    symbol,
    startDate,
    endDate,
    totalTradingDays: tradingDays.length,
  };
}

/**
 * Admin HTTP trigger for building per-contract historical options time series.
 *
 * POST body:
 * - symbol: required; e.g. 'QQQ'
 * - startDate: 'YYYY-MM-DD'; defaults to '2019-01-01'
 * - endDate: 'YYYY-MM-DD'; defaults to yesterday in America/New_York
 * - execute: boolean; defaults to false. When true, runs the builder and
 *   returns a report. When false, returns a plan without touching GCS.
 *
 * Requires the `HISTORICAL_OPTIONS_TIME_SERIES_ADMIN_SECRET` env var and an
 * `x-admin-secret` header. This guard can be replaced with IAM/auth proxy later.
 */
export const triggerHistoricalOptionsTimeSeriesBuild = onRequest(
  {
    timeoutSeconds: 540,
    memory: '4GiB',
    secrets: [timeSeriesBuildAdminSecret],
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

      const body = (req.body || {}) as TriggerTimeSeriesBuildBody;
      const symbol = typeof body.symbol === 'string' ? body.symbol.trim().toUpperCase() : '';
      const startDate = isValidIsoDate(body.startDate) ? body.startDate : '2019-01-01';
      const endDate = isValidIsoDate(body.endDate) ? body.endDate : getYesterdayEt();
      const execute = typeof body.execute === 'boolean' ? body.execute : false;

      if (!symbol) {
        res.status(400).json({ ok: false, error: 'Missing required symbol' });
        return;
      }

      if (startDate > endDate) {
        res.status(400).json({ ok: false, error: 'startDate must be before or equal to endDate' });
        return;
      }

      logger.info('trigger_time_series_build.start', { symbol, startDate, endDate, execute });

      const calendar = new TradingCalendarService();
      if (!execute) {
        const plan = buildPlan(calendar, symbol, startDate, endDate);
        logger.info('trigger_time_series_build.plan', plan);
        res.status(200).json({ ok: true, plan });
        return;
      }

      const service = createTimeSeriesBuilderService();
      const report = await service.buildSymbol(symbol, startDate, endDate);

      logger.info('trigger_time_series_build.success', {
        symbol: report.symbol,
        totalTradingDays: report.totalTradingDays,
        foundDates: report.foundDates,
        missingDates: report.missingDates,
        processedContracts: report.processedContracts,
        failedContracts: report.failedContracts,
      });

      res.status(200).json({ ok: true, report });
    } catch (error: any) {
      const msg = String(error?.message || error);
      logger.error('trigger_time_series_build.error', { error: msg });
      res.status(500).json({ ok: false, error: msg });
    }
  }),
);

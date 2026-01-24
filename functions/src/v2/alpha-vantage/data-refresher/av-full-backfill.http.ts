import { onRequest } from 'firebase-functions/v2/https';
import { getFunctions } from 'firebase-admin/functions';

import { AlphaVantageEndpoint } from '@shared/alpha-vantage';
import { betterLogger } from '../../utils/utils';
import { CloudTask } from '../../common/constants';

const log = betterLogger('av.fullBackfill.http');

interface FullBackfillRequestBody {
  marketDate?: string;
  symbols?: string[] | string;
  includeWeekly?: boolean;
  includeMonthly?: boolean;
}

export const triggerFullBackfillJobs = onRequest({
  // This HTTP endpoint is now a thin trigger that enqueues a background
  // Cloud Task to perform the full-backfill enqueue work. The task handler
  // (processFullBackfillRunTask) runs without HTTP timeouts.
  timeoutSeconds: 60,
  secrets: ['ARCHIVE_FULL_BACKFILL_ADMIN_SECRET'],
}, async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'Method not allowed; use POST' });
      return;
    }

    // Simple shared-secret guard for now; can be replaced with IAM/auth proxy.
    const expectedSecret = String(process.env.ARCHIVE_FULL_BACKFILL_ADMIN_SECRET || '').trim();
    const providedSecret = String(req.headers['x-admin-secret'] || '').trim();
    if (!expectedSecret || !providedSecret || expectedSecret !== providedSecret) {
      res.status(403).json({ ok: false, error: 'Forbidden' });
      return;
    }

    const body = (req.body || {}) as FullBackfillRequestBody;

    const rawMarketDate = typeof body.marketDate === 'string' ? body.marketDate.trim() : '';
    const marketDate = rawMarketDate && /^\d{4}-\d{2}-\d{2}$/.test(rawMarketDate) ? rawMarketDate : undefined;

    let symbols: string[] | undefined;
    if (Array.isArray(body.symbols)) {
      symbols = body.symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean);
    } else if (typeof body.symbols === 'string' && body.symbols.trim()) {
      symbols = body.symbols
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
    }

    const includeWeekly = typeof body.includeWeekly === 'boolean' ? body.includeWeekly : true;
    const includeMonthly = typeof body.includeMonthly === 'boolean' ? body.includeMonthly : true;

    log.info(
      `trigger_full_backfill.start marketDate=${marketDate || 'auto(et)'} includeWeekly=${includeWeekly} includeMonthly=${includeMonthly} symbols=${
        symbols ? symbols.join(',') : 'ALL'
      }`,
      {
        function: 'triggerFullBackfillJobs',
        marketDate: marketDate || 'auto(et)',
        includeWeekly,
        includeMonthly,
        symbols: symbols || 'ALL',
      } as any,
    );

    const queue = getFunctions().taskQueue(CloudTask.FULL_BACKFILL_RUN);

    const endpointsToRun: AlphaVantageEndpoint[] = [];
    if (includeMonthly) {
      endpointsToRun.push(AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED);
    }
    if (includeWeekly) {
      endpointsToRun.push(AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED);
    }
    // Always include DAILY full-backfill as the base interval.
    endpointsToRun.push(AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED);

    for (const endpoint of endpointsToRun) {
      await queue.enqueue({
        marketDate,
        symbols,
        endpoint,
      });
    }

    res.status(202).json({
      ok: true,
      enqueued: true,
      marketDate: marketDate || 'auto(et)',
      includeWeekly,
      includeMonthly,
      symbols: symbols || 'ALL',
      endpoints: endpointsToRun,
    });
  } catch (e: any) {
    const msg = String(e?.message || e);
    log.error(`trigger_full_backfill.error error=${msg}`, {
      function: 'triggerFullBackfillJobs',
      error: msg,
    } as any);
    res.status(500).json({ ok: false, error: msg });
  }
});

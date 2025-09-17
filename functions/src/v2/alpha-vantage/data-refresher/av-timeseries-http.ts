import { onRequest } from 'firebase-functions/v2/https';
import { db } from '../../../firebase-admin-init';
import { AlphaVantageHandlerFactory } from '../alpha-vantage-factory';
import { initializeTimeSeriesIfMissing } from '../firestore/av-firestore-helper';
import { FirestoreCollection } from '@shared/firestore';
import { AlphaVantageEndpoint, AV_TIME_SERIES_ENDPOINT_CONFIGS, TimeSeriesInterval } from '@shared/alpha-vantage';
import { ApiProvider } from '@shared/core';
import { getSymbolTimeSeriesDocPath } from '../../common/firestore/firestore-paths';
import { createLogger } from '../../utils/utils';

const log = createLogger('ts.http');

function parseBool(v: unknown): boolean {
  const s = String(v ?? '').toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function parseIntervalEnum(v: unknown): TimeSeriesInterval | null {
  const raw = String(v ?? '').trim().toUpperCase();
  if (raw === 'DAILY') return TimeSeriesInterval.DAILY;
  if (raw === 'WEEKLY') return TimeSeriesInterval.WEEKLY;
  if (raw === 'MONTHLY') return TimeSeriesInterval.MONTHLY;
  return null;
}

function endpointForInterval(interval: TimeSeriesInterval): AlphaVantageEndpoint {
  switch (interval) {
    case TimeSeriesInterval.DAILY:
      return AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED;
    case TimeSeriesInterval.WEEKLY:
      return AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED;
    case TimeSeriesInterval.MONTHLY:
      return AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED;
    default:
      // Exhaustive
      return AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED;
  }
}

export const refreshAvTimeSeriesHttp = onRequest(async (req, res) => {
  if (process.env.FUNCTIONS_EMULATOR !== 'true') {
    res.status(403).json({ ok: false, error: 'Forbidden outside emulator' });
    return;
  }

  const intervalParam = req.query?.interval;
  const symbolParam = String(req.query?.symbol || '').trim().toUpperCase();
  const force = parseBool(req.query?.force);
  const init = parseBool(req.query?.init);

  const interval = parseIntervalEnum(intervalParam);
  if (interval === null) {
    res.status(400).json({ ok: false, error: "interval must be one of: 'DAILY' | 'WEEKLY' | 'MONTHLY'" });
    return;
  }
  const endpoint = endpointForInterval(interval);
  if (!AV_TIME_SERIES_ENDPOINT_CONFIGS[endpoint]) {
    res.status(400).json({ ok: false, error: `Unsupported endpoint for interval ${interval}` });
    return;
  }

  try {
    const startedAt = Date.now();
    let symbols: string[] = [];
    if (symbolParam) {
      symbols = [symbolParam];
    } else {
      const snap = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
      symbols = snap.docs.map(d => d.id);
    }

    const handler = AlphaVantageHandlerFactory.createHandler(endpoint);
    const results: Array<{
      symbol: string;
      status: 'initialized' | 'refreshed' | 'skipped' | 'error';
      message?: string;
      durationMs?: number;
      docPath?: string;
      latestBarIso?: string | null;
      nextRefreshIso?: string | null;
    }> = [];

    log.info('start', { interval, endpoint, count: symbols.length, force, init, symbols });

    for (const symbol of symbols) {
      try {
        const perStart = Date.now();
        const docPath = getSymbolTimeSeriesDocPath(symbol, endpoint, ApiProvider.ALPHA_VANTAGE);
        if (init) {
          const ok = await initializeTimeSeriesIfMissing(symbol, interval, endpoint);
          // Read top-level metadata for reporting (best effort)
          let latestBarIso: string | null = null;
          let nextRefreshIso: string | null = null;
          try {
            const snap = await db.doc(docPath).get();
            const md = (snap.data() as any)?.metadata;
            const histEndTs: number | null = md?.histEndTs ?? null;
            latestBarIso = histEndTs != null ? new Date(histEndTs).toISOString() : null;
            const nextRefreshAt = md?.nextRefreshAt;
            const nrd = typeof nextRefreshAt?.toDate === 'function' ? nextRefreshAt.toDate() : nextRefreshAt ? new Date(nextRefreshAt) : null;
            nextRefreshIso = nrd ? nrd.toISOString() : null;
          } catch {}
          log.info('symbol.init', { symbol, interval, endpoint, ok, durationMs: Date.now() - perStart, docPath, latestBarIso, nextRefreshIso });
          results.push({
            symbol,
            status: ok ? 'initialized' : 'skipped',
            message: ok ? 'initialized or exists' : 'no data from provider',
            durationMs: Date.now() - perStart,
            docPath,
            latestBarIso,
            nextRefreshIso,
          });
          continue;
        }
        await handler.fetch({ symbol, outputsize: 'compact', __checkWriteToggle: false, force });
        // Read top-level metadata for reporting (best effort)
        let latestBarIso: string | null = null;
        let nextRefreshIso: string | null = null;
        try {
          const snap = await db.doc(docPath).get();
          const md = (snap.data() as any)?.metadata;
          const histEndTs: number | null = md?.histEndTs ?? null;
          latestBarIso = histEndTs != null ? new Date(histEndTs).toISOString() : null;
          const nextRefreshAt = md?.nextRefreshAt;
          const nrd = typeof nextRefreshAt?.toDate === 'function' ? nextRefreshAt.toDate() : nextRefreshAt ? new Date(nextRefreshAt) : null;
          nextRefreshIso = nrd ? nrd.toISOString() : null;
        } catch {}
        log.info('symbol.refresh', { symbol, interval, endpoint, durationMs: Date.now() - perStart, docPath, latestBarIso, nextRefreshIso });
        results.push({ symbol, status: 'refreshed', durationMs: Date.now() - perStart, docPath, latestBarIso, nextRefreshIso });
      } catch (err: any) {
        log.error('symbol.error', { symbol, interval, endpoint, error: String(err?.message || err) });
        results.push({ symbol, status: 'error', message: String(err?.message || err) });
      }
    }

    const finishedAt = Date.now();
    const processed = results.length;
    const refreshed = results.filter(r => r.status === 'refreshed').length;
    const initialized = results.filter(r => r.status === 'initialized').length;
    const errors = results.filter(r => r.status === 'error').length;

    log.info('summary', { interval, endpoint, processed, refreshed, initialized, errors, durationMs: finishedAt - startedAt });

    res.status(200).json({
      ok: true,
      interval,
      endpoint,
      startedAtIso: new Date(startedAt).toISOString(),
      finishedAtIso: new Date(finishedAt).toISOString(),
      totalDurationMs: finishedAt - startedAt,
      processed,
      refreshed,
      initialized,
      errors,
      results,
    });
  } catch (error: any) {
    log.error('fatal', { error: String(error?.message || error) });
    res.status(500).json({ ok: false, error: error?.message || 'Unknown error' });
  }
});

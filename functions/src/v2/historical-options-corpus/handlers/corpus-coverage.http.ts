/**
 * getHistoricalOptionsCorpusCoverage — read-only coverage surface (Task #156).
 *
 * Computes per-symbol corpus coverage live: swing-doc pivot plan diffed
 * against stored corpus objects plus latest run-item status →
 * planned/seeded/missing/failed/in_flight + per-date status + current
 * interim date. Zero writes; safe to poll.
 *
 * POST body (all optional):
 * - symbols: string[] or comma-separated; defaults to all options-enabled
 *   (an explicit empty list reports nothing). Non-enabled symbols are
 *   reported with optionsEnabled=false rather than dropped — this is a
 *   read surface, so the curation gate does not bound anything.
 *
 * Requires `x-admin-secret` matching HISTORICAL_OPTIONS_COVERAGE_ADMIN_SECRET
 * (same convention as backfillSwingSets).
 */
import { defineSecret } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import type { Request, Response } from 'express';

import { normalizeSymbolList, requireAdminSecret } from '../../common/http-admin';
import { withCors } from '../../utils/cors-middleware';
import { createCorpusCoverageDeps, runCorpusCoverage } from '../services/corpus-coverage.service';

const corpusCoverageAdminSecret = defineSecret('HISTORICAL_OPTIONS_COVERAGE_ADMIN_SECRET');

interface CoverageBody {
  symbols?: string[] | string;
}

export const getHistoricalOptionsCorpusCoverage = onRequest(
  {
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: [corpusCoverageAdminSecret],
  },
  withCors(async (req: Request, res: Response) => {
    try {
      if (req.method !== 'POST') {
        res.status(405).json({ ok: false, error: 'Method not allowed; use POST' });
        return;
      }
      if (!requireAdminSecret(req, res, corpusCoverageAdminSecret)) return;

      const body = (req.body || {}) as CoverageBody;
      const symbols = normalizeSymbolList(body.symbols);

      console.log('[corpus-coverage] start', { symbols });
      const report = await runCorpusCoverage(symbols, createCorpusCoverageDeps());
      console.log('[corpus-coverage] done', {
        symbols: report.symbols.length,
        seeded: report.symbols.reduce((n, s) => n + s.seeded, 0),
        missing: report.symbols.reduce((n, s) => n + s.missing, 0),
        failed: report.symbols.reduce((n, s) => n + s.failed, 0),
        errored: report.symbols.filter((s) => s.error).length,
      });
      res.status(200).json({ ok: true, report });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[corpus-coverage] error', { error: msg });
      res.status(500).json({ ok: false, error: msg });
    }
  }),
);

import { onCall } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';

import { db } from '../../../firebase-admin-init';
import { FirestoreCollection } from '@shared/firestore';
import {
  AlphaVantageEndpoint,
  BulkImportItem,
  BulkImportResult,
  BulkImportOutcome,
  BulkImportSymbolLog,
} from '@shared/alpha-vantage';
import { AlphaVantageHandlerFactory } from '../alpha-vantage-factory';

interface BulkImportRequest {
  clientId: string;
  items: BulkImportItem[];
}

/**
 * Callable function to perform bulk symbol onboarding from a JSON payload.
 *
 * Phase 1: input validation, tracked-symbols pre-check, ETF aggregation, and logging.
 * AV SYMBOL_SEARCH + symbol-import-queue writes will be added in a follow-up step.
 */
export const bulkImportSymbolsV2 = onCall(
  {
    secrets: ['ALPHAVANTAGE_API_KEY'],
  },
  async (request): Promise<BulkImportResult> => {
  const data = (request.data ?? {}) as Partial<BulkImportRequest>;

  if (!Array.isArray(data.items) || data.items.length === 0) {
    console.warn('bulkImportSymbolsV2: invalid or empty items payload', data);
    return {
      ok: false,
      alreadyTracked: 0,
      autoAccepted: 0,
      queuedForReview: 0,
      failed: 0,
      errors: [
        {
          symbol: '',
          name: '',
          error: 'Invalid or empty items payload',
        },
      ],
    };
  }

  const clientId = data.clientId ?? 'UNKNOWN_CLIENT';
  const items = data.items;

  console.log(
    `bulkImportSymbolsV2: starting bulk import for clientId=${clientId}, count=${items.length}`,
  );

  let alreadyTracked = 0;
  let autoAccepted = 0;
  let queuedForReview = 0;
  let failed = 0;

  const errors: BulkImportResult['errors'] = [];
  const logs: BulkImportSymbolLog[] = [];

  // ETF membership accumulator: ETF -> Set<symbol>
  const etfMap = new Map<string, Set<string>>();

  // Prepare a single SYMBOL_SEARCH handler for the whole run.
  const symbolSearchHandler = AlphaVantageHandlerFactory.createHandler(
    AlphaVantageEndpoint.SYMBOL_SEARCH,
  );

  for (const item of items) {
    const symbol = item.symbol.toUpperCase();

    // Build ETF map from input regardless of AV outcome.
    for (const rawEtf of item.etfs ?? []) {
      const etf = rawEtf.toUpperCase();
      if (!etfMap.has(etf)) {
        etfMap.set(etf, new Set());
      }
      etfMap.get(etf)!.add(symbol);
    }

    try {
      // Idempotency + recovery: check if symbol already exists in tracked-symbols.
      const trackedRef = db.collection(FirestoreCollection.TRACKED_SYMBOLS).doc(symbol);
      const trackedSnap = await trackedRef.get();

      if (trackedSnap.exists) {
        const existing = (trackedSnap.data() ?? {}) as any;
        const createdAt = existing._createdAt as Timestamp | undefined;

        // Fixed recovery cutoff: any tracked-symbol created on or after
        // 2026-01-03 UTC is treated as a potentially incomplete import and
        // will be deleted and re-imported. Older docs are preserved and only
        // have ETF membership merged.
        const now = Timestamp.now();
        const cutoffDate = new Date('2026-01-03T00:00:00.000Z');

        if (createdAt) {
          const createdDate = createdAt.toDate();

          if (createdDate < cutoffDate) {
            // Legacy/long-lived symbol before cutoff: leave doc intact, just
            // merge ETF membership.
            const existingEtfs: string[] = Array.isArray(existing.etfs) ? existing.etfs : [];
            const incomingEtfs = (item.etfs ?? []).map((e) => e.toUpperCase());
            const mergedEtfs = Array.from(new Set([...(existingEtfs ?? []), ...incomingEtfs]));

            await trackedRef.set(
              {
                etfs: mergedEtfs,
                _lastUpdated: now,
              },
              { merge: true },
            );

            alreadyTracked++;
            logs.push({
              symbol,
              name: item.name,
              exchange: item.exchange,
              etfs: mergedEtfs,
              outcome: BulkImportOutcome.ALREADY_TRACKED,
              reason: 'UPDATED_ETFS',
            });
            continue;
          }

          // Doc exists and was created on/after the cutoff date: treat as
          // incomplete import. Delete so we can re-run the full AV validation
          // + creation flow and re-trigger onSymbolAdded.
          await trackedRef.delete();
          console.log(
            'bulkImportSymbolsV2: deleted cutoff-tracked-symbol to allow re-import',
            { symbol, createdAt: createdAt.toDate().toISOString(), cutoffDate: cutoffDate.toISOString() },
          );
          // Fall through to fresh-import path below.
        } else {
          // No _createdAt metadata; treat as legacy and preserve, merging
          // ETF membership only.
          console.log('bulkImportSymbolsV2: existing tracked-symbol with NO _createdAt, merging ETFs only', {
            symbol,
            existingEtfsRaw: existing.etfs,
          });
          const existingEtfs: string[] = Array.isArray(existing.etfs) ? existing.etfs : [];
          const incomingEtfs = (item.etfs ?? []).map((e) => e.toUpperCase());
          const mergedEtfs = Array.from(new Set([...(existingEtfs ?? []), ...incomingEtfs]));

          await trackedRef.set(
            {
              etfs: mergedEtfs,
              _lastUpdated: now,
            },
            { merge: true },
          );

          alreadyTracked++;
          logs.push({
            symbol,
            name: item.name,
            exchange: item.exchange,
            etfs: mergedEtfs,
            outcome: BulkImportOutcome.ALREADY_TRACKED,
            reason: 'UPDATED_ETFS_NO_CREATED_AT',
          });
          continue;
        }
      }

      // Phase 2 – AV SYMBOL_SEARCH + strict auto-accept + queue classification.

      // Call AV SYMBOL_SEARCH using the symbol as the primary keyword.
      // AvSymbolSearchHandler already transforms the raw Alpha Vantage response into
      // an array of SvtAvSymbolMatch objects (symbol, name, region, currency, matchScore, ...).
      const searchStartedAt = Date.now();
      const searchResponse = await symbolSearchHandler.fetch({
        keywords: symbol,
      });
      const searchFinishedAt = Date.now();
      const searchDurationMs = searchFinishedAt - searchStartedAt;

      console.log('bulkImportSymbolsV2: SYMBOL_SEARCH completed', {
        symbol,
        durationMs: searchDurationMs,
      });

      // Throttle between AV requests to avoid burst-rate limiting.
      const throttleMs = 3000;
      console.log('bulkImportSymbolsV2: throttling before next SYMBOL_SEARCH', {
        symbol,
        throttleMs,
      });
      await new Promise((resolve) => setTimeout(resolve, throttleMs));

      // AvSymbolSearchHandler.fetch returns SvtAvSymbolMatch[] directly (response.data),
      // not an object with a nested data property.
      const candidates = Array.isArray(searchResponse)
        ? (searchResponse as any[])
        : [];

      if (candidates.length > 0) {
        // Log a compact view of the first few candidates for diagnostics.
        const preview = candidates.slice(0, 3).map((c: any) => ({
          symbol: c.symbol,
          name: c.name,
          region: c.region,
          currency: c.currency,
          matchScore: c.matchScore,
        }));
        console.log(`bulkImportSymbolsV2: AV SYMBOL_SEARCH candidates for ${symbol}:`, preview);
      } else {
        console.warn(`bulkImportSymbolsV2: AV SYMBOL_SEARCH returned no candidates for ${symbol}`);
      }

      const strictMatches = candidates.filter((c: any) => {
        const candSymbol = (c.symbol ?? '').toString().toUpperCase();
        const rawScore = c.matchScore;
        const matchScore = typeof rawScore === 'string' ? Number(rawScore) : Number(rawScore ?? 0);
        return candSymbol === symbol && matchScore === 1.0;
      });

      const avCandidateCount = candidates.length;

      if (strictMatches.length === 1) {
        // AUTO_ACCEPTED: exactly one strict match (symbol + score 1.0).
        autoAccepted++;

        const best = strictMatches[0] as any;
        const now = Timestamp.now();

        // Build the tracked-symbols document primarily from the AV response, then
        // overlay exchange and ETF membership from the bulk-import input.
        const avDoc = {
          symbol: (best.symbol ?? symbol).toString().toUpperCase(),
          name: best.name ?? item.name,
          type: best.type,
          region: best.region,
          marketOpen: best.marketOpen,
          marketClose: best.marketClose,
          timezone: best.timezone,
          currency: best.currency,
          matchScore: best.matchScore,
        } as any;

        const etfs = (item.etfs ?? []).map((e) => e.toUpperCase());

        await trackedRef.set(
          {
            ...avDoc,
            exchange: item.exchange,
            etfs,
            _createdAt: now,
            _lastUpdated: now,
            _isActive: true,
          },
          { merge: true },
        );

        logs.push({
          symbol,
          name: item.name,
          exchange: item.exchange,
          etfs: item.etfs,
          outcome: BulkImportOutcome.AUTO_ACCEPTED,
          avCandidateCount,
        });
      } else if (avCandidateCount > 0) {
        // QUEUED_PENDING_NO_STRICT_MATCH: candidates exist but no strict match.
        queuedForReview++;

        const queueRef = db.collection('symbol-import-queue').doc();
        const now = Timestamp.now();

        await queueRef.set({
          clientId,
          requestedSymbol: symbol,
          requestedName: item.name,
          exchange: item.exchange,
          etfs: item.etfs ?? [],
          status: 'PENDING',
          reason: 'NO_STRICT_MATCH',
          candidates,
          createdAt: now,
          updatedAt: now,
        });

        logs.push({
          symbol,
          name: item.name,
          exchange: item.exchange,
          etfs: item.etfs,
          outcome: BulkImportOutcome.QUEUED_PENDING_NO_STRICT_MATCH,
          reason: 'NO_STRICT_MATCH',
          avCandidateCount,
        });

        // TODO: Create symbol-import-queue doc with full candidates list and NO_STRICT_MATCH reason.
      } else {
        // FAILED: AV returned zero candidates.
        failed++;
        const reason = 'NO_CANDIDATES';
        errors.push({ symbol, name: item.name, error: reason });
        logs.push({
          symbol,
          name: item.name,
          exchange: item.exchange,
          etfs: item.etfs,
          outcome: BulkImportOutcome.FAILED,
          reason,
          avCandidateCount,
        });
      }
    } catch (err: any) {
      failed++;

      // Differentiate Alpha Vantage errors from Firestore/other errors for clearer diagnostics.
      const isAlphaVantageError =
        err &&
        (err.name === 'AlphaVantageError' ||
          typeof err.code === 'string' ||
          (err.response && err.response.data && err.response.data['Error Message']));

      let reason = 'FIRESTORE_ERROR';
      let errorMessage = err instanceof Error ? err.message : String(err);

      if (isAlphaVantageError) {
        const code = typeof err.code === 'string' ? err.code : 'AV_ERROR';
        reason = code === 'ETIMEDOUT' ? 'AV_ERROR_ETIMEDOUT' : `AV_ERROR_${code}`;
        errorMessage = `Alpha Vantage error (${code}): ${errorMessage}`;
        console.error(`bulkImportSymbolsV2: AV error for ${symbol}:`, err);
      } else {
        console.error(`bulkImportSymbolsV2: Firestore/other error for ${symbol}:`, err);
      }

      errors.push({ symbol, name: item.name, error: errorMessage });
      logs.push({
        symbol,
        name: item.name,
        exchange: item.exchange,
        etfs: item.etfs,
        outcome: BulkImportOutcome.FAILED,
        reason,
      });
    }
  }

  // Log ETF membership summary derived purely from input.
  for (const [etf, symbols] of etfMap.entries()) {
    const symbolList = Array.from(symbols).sort();
    console.log(`bulkImportSymbolsV2 ETF summary: etf=${etf} symbols=[${symbolList.join(', ')}]`);
  }

  const result: BulkImportResult = {
    ok: failed === 0,
    alreadyTracked,
    autoAccepted,
    queuedForReview,
    failed,
    errors,
    logs,
  };

  console.log('bulkImportSymbolsV2: run completed with summary:', {
    clientId,
    alreadyTracked: result.alreadyTracked,
    autoAccepted: result.autoAccepted,
    queuedForReview: result.queuedForReview,
    failed: result.failed,
    errorCount: result.errors.length,
  });

  return result;
});

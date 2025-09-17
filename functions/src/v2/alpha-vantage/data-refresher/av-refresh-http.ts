import { onRequest } from 'firebase-functions/v2/https';
import { runRefreshAlphaVantageDataV2 } from './av-refresh-manager';

/**
 * HTTP wrapper to run the Alpha Vantage refresh manager once.
 * - Intended for local development with emulators.
 * - In non-emulator environments, returns 403 to avoid accidental exposure.
 */
export const refreshAlphaVantageDataV2Http = onRequest(async (req, res) => {
  if (process.env.FUNCTIONS_EMULATOR !== 'true') {
    res.status(403).json({ ok: false, error: 'Forbidden outside emulator' });
    return;
  }

  try {
    const startedAt = Date.now();
    const forceParam = String((req.query?.force ?? '')).toLowerCase();
    const force = forceParam === '1' || forceParam === 'true';
    const result = await runRefreshAlphaVantageDataV2({ force });
    const finishedAt = Date.now();

    // Lightweight console log, similar to TS HTTP
    console.log(
      `[AV-HTTP] processed=${result.symbolsChecked} updated=${result.symbolsUpdatedCount} fresh=${result.freshCount} stale=${result.staleCount} force=${result.force} durationMs=${finishedAt - startedAt}`
    );

    res.status(200).json({
      ok: true,
      startedAtIso: new Date(startedAt).toISOString(),
      finishedAtIso: new Date(finishedAt).toISOString(),
      totalDurationMs: finishedAt - startedAt,
      ...result,
    });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: error?.message || 'Unknown error' });
  }
});

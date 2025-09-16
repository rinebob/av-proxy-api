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
    const forceParam = String((req.query?.force ?? '')).toLowerCase();
    const force = forceParam === '1' || forceParam === 'true';
    const result = await runRefreshAlphaVantageDataV2({ force });
    res.status(200).json({ ok: true, ...result });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: error?.message || 'Unknown error' });
  }
});

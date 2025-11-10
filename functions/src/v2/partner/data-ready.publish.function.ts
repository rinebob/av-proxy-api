import { onRequest } from 'firebase-functions/v2/https';
import type { Request, Response } from 'express';

import { authenticateRequestEither, handleOptionsRequest, setCorsHeaders } from '../utils/utils';
import { enqueueDataReadyInternal } from './data-ready.handler';
import { validateDataReadyPayload, type DataReadyPayloadV1 } from './schemas/data-ready.schema';
import { INTERNAL_PUBLISHER_AUDIT_EMAIL, PartnerPhase, PartnerTrigger } from './constants';
import { TimeSeriesInterval } from '@shared/alpha-vantage';

// Small helper to derive phase and marketDate in ET, similar to heartbeat
function derivePhaseAndMarketDate(): { phase: PartnerPhase; marketDate: string } {
  const tz = 'America/New_York';
  const now = new Date();
  const marketDate = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false }).format(now));
  const phase: PartnerPhase = hour >= 16 ? PartnerPhase.POST : PartnerPhase.PRE;
  return { phase, marketDate };
}

/**
 * partnerDataReadyPublishV2 (HTTP)
 * Secure internal endpoint to publish a DataReady payload to Pub/Sub for RS testing.
 * - Auth: authenticateRequestEither (Firebase ID or Google OIDC service account)
 * - Method: POST (JSON), OPTIONS supported for CORS
 * - Body: DataReadyPayloadV1 or { autofill: true, intervals?: TimeSeriesInterval[], env?: string, trigger?: PartnerTrigger }
 */
export const partnerDataReadyPublishV2 = onRequest(async (req: Request, res: Response) => {
  // CORS preflight
  if (handleOptionsRequest(req, res)) return;

  if (req.method !== 'POST') {
    setCorsHeaders(res);
    res.status(405).json({ ok: false, error: 'Method Not Allowed', message: 'Use POST with JSON body.' });
    return;
  }

  // Auth (dual-path)
  const auth = await authenticateRequestEither(req as any, res as any);
  if (!auth) return; // authenticateRequestEither already responded with error

  try {
    const body = (req.body ?? {}) as any;

    let payload: DataReadyPayloadV1;

    if (body && body.autofill === true) {
      const { phase, marketDate } = derivePhaseAndMarketDate();
      const intervals: TimeSeriesInterval[] = Array.isArray(body.intervals) && body.intervals.length > 0
        ? body.intervals
        : [TimeSeriesInterval.DAILY];
      const hhmm = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).replace(':', '');
      const runId = `${marketDate}-${phase}-${hhmm}`;
      payload = {
        version: 'v1',
        runId,
        phase,
        intervals,
        time: Date.now(),
        marketDate,
        env: typeof body.env === 'string' ? body.env : (process.env.NODE_ENV || 'dev'),
        trigger: (body.trigger === PartnerTrigger.HEARTBEAT || body.trigger === PartnerTrigger.SCHEDULED || body.trigger === PartnerTrigger.MANUAL)
          ? body.trigger
          : PartnerTrigger.MANUAL,
      } as DataReadyPayloadV1;
    } else {
      payload = body as DataReadyPayloadV1;
      // Default trigger to MANUAL for this endpoint when not specified
      if (!payload.trigger) {
        payload.trigger = PartnerTrigger.MANUAL;
      }
    }

    // Validate and publish
    const { ok, errors, value } = validateDataReadyPayload(payload);
    if (!ok || !value) {
      setCorsHeaders(res);
      res.status(400).json({ ok: false, error: 'Invalid payload', details: errors });
      return;
    }

    const callerEmail = (auth as any)?.serviceAccountEmail || INTERNAL_PUBLISHER_AUDIT_EMAIL;
    const pub = await enqueueDataReadyInternal(value, callerEmail, { runType: 'manual' });

    setCorsHeaders(res);
    res.status(200).json({ ...pub, ok: true });
  } catch (err: any) {
    setCorsHeaders(res);
    res.status(500).json({ ok: false, error: 'Internal Error', message: String(err?.message || err) });
  }
});

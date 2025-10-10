import { onSchedule } from 'firebase-functions/v2/scheduler';
import { TimeSeriesInterval } from '@shared/alpha-vantage';
import type { DataReadyPayloadV1 } from './schemas/data-ready.schema';
import { enqueueDataReadyInternal } from './data-ready.handler';
import { INTERNAL_PUBLISHER_AUDIT_EMAIL, PartnerPhase } from './constants';
import { PARTNER_HEARTBEAT_SCHEDULE } from '../common/function-schedules';

// Determine trading phase automatically using Eastern Time and derive market date (YYYY-MM-DD)
function getAutoPhaseAndMarketDate(): { phase: PartnerPhase; marketDate: string } {
  const tz = 'America/New_York';
  const now = new Date();
  const fmtDate = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const marketDate = fmtDate.format(now); // YYYY-MM-DD
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false }).format(now));
  const phase: PartnerPhase = hour >= 16 ? PartnerPhase.POST : PartnerPhase.PRE;
  return { phase, marketDate };
}

/**
 * Scheduled heartbeat publisher for partner-data-ready topic.
 * Emits a minimal DataReadyPayloadV1 every 5 minutes for subscriber verification.
 * Gated by env flag ENABLE_PARTNER_HEARTBEAT === 'true' to avoid unexpected noise in prod.
 */
export const partnerDataReadyHeartbeat = onSchedule(
  {
    schedule: PARTNER_HEARTBEAT_SCHEDULE,
    timeZone: 'America/Los_Angeles',
  },
  async () => {
    // Feature flag: only run when explicitly enabled
    if (process.env.ENABLE_PARTNER_HEARTBEAT !== 'true') {
      console.log('[partnerDataReadyHeartbeat] Skipped: ENABLE_PARTNER_HEARTBEAT is not "true"');
      return;
    }

    const { phase, marketDate } = getAutoPhaseAndMarketDate();
    const runId = `${marketDate}-${phase}`;

    const payload: DataReadyPayloadV1 = {
      version: 'v1',
      runId,
      phase,
      intervals: [TimeSeriesInterval.DAILY],
      time: Date.now(),
      marketDate,
      env: (process.env.NODE_ENV || 'dev') as string,
    };

    // Mark as heartbeat so downstream consumers can filter easily
    const res = await enqueueDataReadyInternal(payload, INTERNAL_PUBLISHER_AUDIT_EMAIL, { runType: 'heartbeat', heartbeat: 'true' });
    console.log('[partnerDataReadyHeartbeat] Published heartbeat', { runId, messageId: res.messageId, status: res.status });
  }
);

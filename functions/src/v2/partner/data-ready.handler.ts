import { randomUUID } from 'crypto';
import { db } from '../../firebase-admin-init';

import { validateDataReadyPayload, type DataReadyPayloadV1 } from './schemas/data-ready.schema';
import { PARTNER_DATA_READY_TOPIC, INTERNAL_PUBLISHER_AUDIT_EMAIL, PartnerPublishStatus } from './constants';
import { betterLogger } from '../utils/utils';

/**
 * Internal Pub/Sub publisher for partner data-ready notifications.
 * Publishes to topic `partner-data-ready` in the current GCP project.
 */
async function publishToPubSub(payload: DataReadyPayloadV1, attributes: Record<string, string>) {
  // Lazy import to avoid bringing dependency into cold path if not used during tests.
  const { PubSub } = await import('@google-cloud/pubsub');
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT;
  const pubsub = projectId ? new PubSub({ projectId }) : new PubSub();
  const topicName = PARTNER_DATA_READY_TOPIC;
  const topic = pubsub.topic(topicName);

  try {
    return await topic.publishMessage({ json: payload, attributes });
  } catch (err: any) {
    // In the emulator, auto-create the topic if it's missing (NOT_FOUND: code 5), then retry once.
    const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true' || !!process.env.PUBSUB_EMULATOR_HOST;
    if (isEmulator && (err?.code === 5 || (typeof err?.message === 'string' && err.message.includes('NOT_FOUND')))) {
      try {
        await pubsub.createTopic(topicName);
      } catch (createErr: any) {
        // ALREADY_EXISTS: code 6 — safe to ignore in race conditions
        if (createErr?.code !== 6) {
          throw err;
        }
      }
      // Retry once after ensuring topic exists
      return await topic.publishMessage({ json: payload, attributes });
    }
    throw err;
  }
}

/**
 * enqueueDataReadyInternal
 * Programmatic enqueue used by internal codepaths (e.g., AV refresh manager).
 * - No HTTP/OIDC
 * - Upserts runs/{runId}
 * - Publishes to Pub/Sub and marks the run as enqueued
 * - Idempotent for existing non-failed runs
 */
const drLogger = betterLogger('pDR.H');

export async function enqueueDataReadyInternal(
  payload: DataReadyPayloadV1,
  callerEmail?: string,
  extraAttributes?: Record<string, string>,
): Promise<{ ok: true; requestId: string; messageId?: string; status: string }>
{
  const requestId = randomUUID();

  // Validate payload structure
  const { ok, value, errors } = validateDataReadyPayload(payload);
  if (!ok) {
    throw new Error(`Invalid payload: ${JSON.stringify(errors)}`);
  }
  const validPayload = value as DataReadyPayloadV1;
  // Provide a PascalCase alias for consumers expecting NextRefreshAt in the JSON body
  if (validPayload.nextRefreshAtUTC && !(validPayload as any).NextRefreshAt) {
    (validPayload as any).NextRefreshAt = validPayload.nextRefreshAtUTC;
  }
  const { runId } = validPayload;

  const runRef = db.collection('runs').doc(runId);

  // Idempotency: if run exists and not failed, return early for BEGIN/heartbeat only.
  // Allow END payloads to proceed to update timing/end fields even if a run already exists.
  const existing = await runRef.get();
  if (existing.exists) {
    const status = existing.get('status');
    const isHeartbeat = extraAttributes?.heartbeat === 'true';
    const isEnd = validPayload.status === PartnerPublishStatus.END;
    if (!isHeartbeat && status && status !== 'failed' && !isEnd) {
      return { ok: true, requestId, status };
    }
  }

  // Normalize counts (no legacy mirrors)
  const symbolsUpdated = Number.isInteger(validPayload.symbolsUpdatedCount) ? (validPayload.symbolsUpdatedCount as number) : 0;
  const deltaCount = Array.isArray(validPayload.deltaFinalizedSymbols) ? validPayload.deltaFinalizedSymbols.length : 0;
  const failureCount = (extraAttributes && typeof extraAttributes.failures === 'string') ? Number(extraAttributes.failures) : undefined;
  const successCount = (extraAttributes && typeof extraAttributes.successes === 'string') ? Number(extraAttributes.successes) : undefined;

  // Determine status mapping
  const topLevelStatus: 'processing' | 'completed' | 'failed' =
    (validPayload.status === PartnerPublishStatus.END)
      ? ((typeof failureCount === 'number' && failureCount > 0) ? 'failed' : 'completed')
      : 'processing';

  // Time fields and human-readable ET times
  const isBegin = validPayload.status === PartnerPublishStatus.BEGIN;
  const isEnd = validPayload.status === PartnerPublishStatus.END;
  const nextRefreshAtUTC = validPayload.nextRefreshAtUTC ?? null;

  const existingCreatedAtUTC = existing.exists ? existing.get('timing.createdAtUTC') : undefined;
  const existingStartTimeET = existing.exists ? existing.get('startTimeET') : undefined;

  const nowIso = new Date().toISOString();
  const startTimeETFormatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date());
  const endTimeETFormatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(new Date());

  // Build upsert payload conditionally to avoid overwriting BEGIN fields on END
  const upsert: any = {
    status: topLevelStatus,
    phase: validPayload.phase,
    interval: Array.isArray(validPayload.intervals) && validPayload.intervals.length > 0 ? validPayload.intervals[0] : null,
    marketDate: validPayload.marketDate || null,
    counts: {
      symbolsUpdated,
      pendingCount: (typeof validPayload.pendingCount === 'number') ? validPayload.pendingCount : null,
      finalizedCountTotal: (typeof validPayload.finalizedCountTotal === 'number') ? validPayload.finalizedCountTotal : null,
      deltaCount,
      failures: (typeof failureCount === 'number' && Number.isFinite(failureCount)) ? failureCount : null,
      successes: (typeof successCount === 'number' && Number.isFinite(successCount)) ? successCount : null,
    },
    timing: {
      nextRefreshAtUTC,
    },
    // Normalized meta for audit without echoing full payload
    runMeta: {
      requestId,
      publisherEmail: (callerEmail || INTERNAL_PUBLISHER_AUDIT_EMAIL).toLowerCase(),
      env: validPayload.env || (process.env.NODE_ENV || 'dev'),
      runType: (extraAttributes && typeof extraAttributes.runType === 'string') ? extraAttributes.runType : undefined,
      trigger: validPayload.trigger || undefined,
      payloadVersion: validPayload.version,
    },
  };

  if (isBegin && !existingCreatedAtUTC) {
    upsert.timing.createdAtUTC = nowIso;
  }
  if (isEnd) {
    upsert.timing.finishedAtUTC = validPayload.endTimeUTC || nowIso;
  }
  if (isBegin && !existingStartTimeET) {
    upsert.startTimeET = startTimeETFormatted;
  }
  if (isEnd) {
    upsert.endTimeET = endTimeETFormatted;
  }

  // Upsert run state (simplified doc)
  await runRef.set(upsert, { merge: true });
  // Human-readable confirmation that the runs doc was written/updated
  drLogger.info('runs.upsert.received', {
    function: 'eDRI',
    symbol: 'RUN',
    marketDate: (upsert.marketDate as string) || 'n/a',
    interval: (upsert.interval as string) || 'n/a',
    endpoint: 'DATA_READY_RUN',
    runId,
    message: 'Run doc written/updated',
  });

  // Build Pub/Sub attributes (do not persist to Firestore)
  const attributes: Record<string, string> = {
    runId: validPayload.runId,
    version: validPayload.version,
    phase: validPayload.phase,
  };
  if (validPayload.marketDate) attributes.marketDate = validPayload.marketDate;
  if (validPayload.env) attributes.env = validPayload.env;
  if (validPayload.nextRefreshAtUTC) attributes.NextRefreshAt = validPayload.nextRefreshAtUTC;
  if (extraAttributes) {
    for (const [k, v] of Object.entries(extraAttributes)) {
      if (v != null) attributes[k] = String(v);
    }
  }

  // Publish to Pub/Sub
  const messageId = await publishToPubSub(validPayload, attributes);

  await runRef.set({
    runMeta: { messageId },
  }, { merge: true });

  // Confirm that the run has been enqueued to Pub/Sub
  drLogger.info('runs.upsert.enqueued', {
    function: 'eDRI',
    marketDate: (upsert.marketDate as string) || 'n/a',
    interval: (upsert.interval as string) || 'n/a',
    endpoint: 'DATA_READY_RUN',
    runId,
    message: 'Run enqueued to Pub/Sub',
  });

  // If this is an END payload, log the final runs doc snapshot for verification
  if (validPayload.status === PartnerPublishStatus.END) {
    try {
      await runRef.get();
      // Final snapshot exists primarily for ad-hoc verification; keep log succinct.
      drLogger.info('runs.end.doc', {
        function: 'eDRI',
        marketDate: (upsert.marketDate as string) || 'n/a',
        interval: (upsert.interval as string) || 'n/a',
        endpoint: 'DATA_READY_RUN',
        runId,
        message: 'Run doc snapshot exists. RUN COMPLETE',
      });
    } catch {}
  }

  return { ok: true, requestId, messageId, status: 'enqueued' };
}

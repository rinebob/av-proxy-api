import { randomUUID } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../../firebase-admin-init';

import { validateDataReadyPayload, type DataReadyPayloadV1 } from './schemas/data-ready.schema';
import { PARTNER_DATA_READY_TOPIC, INTERNAL_PUBLISHER_AUDIT_EMAIL, PartnerPublishStatus } from './constants';

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

  // Normalize counts with mirrors for transition
  const symbols = Number.isInteger(validPayload.symbolsUpdatedCount) ? (validPayload.symbolsUpdatedCount as number) : 0;
  const baselines = Number.isInteger(validPayload.baselinesUpdatedCount) ? (validPayload.baselinesUpdatedCount as number) : 0;

  // Derived counts from staged flow
  const deltaCount = Array.isArray(validPayload.deltaFinalizedSymbols) ? validPayload.deltaFinalizedSymbols.length : 0;

  // Upsert run state (lean doc)
  await runRef.set({
    status: 'received',
    phase: validPayload.phase,
    intervals: validPayload.intervals,
    marketDate: validPayload.marketDate || null,
    counts: {
      // Legacy mirrors retained (non-zero if provided in payload)
      symbolsUpdated: symbols,
      baselinesUpdated: baselines,
      symbolsUpdatedCount: symbols,
      baselinesUpdatedCount: baselines,
      // New staged-flow counters
      pendingCount: (typeof validPayload.pendingCount === 'number') ? validPayload.pendingCount : null,
      finalizedCountTotal: (typeof validPayload.finalizedCountTotal === 'number') ? validPayload.finalizedCountTotal : null,
      deltaCount,
    },
    // RS header projection for UI
    header: {
      status: validPayload.status ?? null,
      runStatus: validPayload.runStatus ?? null,
    },
    // Grouped timing fields
    timing: {
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      enqueuedAt: null,
      endTimeUTC: validPayload.status === PartnerPublishStatus.END ? (validPayload.endTimeUTC || new Date().toISOString()) : null,
      nextRefreshAtUTC: validPayload.nextRefreshAtUTC ?? null,
      finalizedAtUTC: validPayload.finalizedAtUTC ?? null,
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
  }, { merge: true });
  try {
    // Confirm runs doc write (received)
    console.log(JSON.stringify({
      component: 'partner.data-ready',
      event: 'runs.upsert.received',
      runId,
      path: `runs/${runId}`,
    }));
  } catch {}

  // Build Pub/Sub attributes (do not persist to Firestore)
  const attributes: Record<string, string> = {
    runId: validPayload.runId,
    version: validPayload.version,
    phase: validPayload.phase,
  };
  if (validPayload.marketDate) attributes.marketDate = validPayload.marketDate;
  if (validPayload.env) attributes.env = validPayload.env;
  if (extraAttributes) {
    for (const [k, v] of Object.entries(extraAttributes)) {
      if (v != null) attributes[k] = String(v);
    }
  }

  // Publish to Pub/Sub
  const messageId = await publishToPubSub(validPayload, attributes);

  await runRef.set({
    status: 'enqueued',
    timing: {
      enqueuedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    runMeta: {
      messageId,
    },
  }, { merge: true });

  try {
    // Confirm runs doc write (enqueued)
    console.log(JSON.stringify({
      component: 'partner.data-ready',
      event: 'runs.upsert.enqueued',
      runId,
      messageId,
      path: `runs/${runId}`,
    }));
  } catch {}

  // If this is an END payload, log the final runs doc snapshot for verification
  if (validPayload.status === PartnerPublishStatus.END) {
    try {
      const finalSnap = await runRef.get();
      console.log(JSON.stringify({
        component: 'partner.data-ready',
        event: 'runs.end.doc',
        path: `runs/${runId}`,
        data: finalSnap.data(),
      }));
    } catch {}
  }

  return { ok: true, requestId, messageId, status: 'enqueued' };
}

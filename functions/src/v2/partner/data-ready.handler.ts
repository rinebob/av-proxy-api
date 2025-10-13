import { randomUUID } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../../firebase-admin-init';

import { validateDataReadyPayload, type DataReadyPayloadV1 } from './schemas/data-ready.schema';
import { PARTNER_DATA_READY_TOPIC, INTERNAL_PUBLISHER_AUDIT_EMAIL } from './constants';

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

  // Idempotency: if run exists and not failed, return early
  const existing = await runRef.get();
  if (existing.exists) {
    const status = existing.get('status');
    const isHeartbeat = extraAttributes?.heartbeat === 'true';
    if (!isHeartbeat && status && status !== 'failed') {
      return { ok: true, requestId, status };
    }
  }

  // Upsert run state
  await runRef.set({
    status: 'received',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    phase: validPayload.phase,
    intervals: validPayload.intervals,
    marketDate: validPayload.marketDate || null,
    counts: {
      baselinesUpdatedCount: validPayload.baselinesUpdatedCount ?? null,
      symbolsUpdatedCount: validPayload.symbolsUpdatedCount ?? null,
    },
    // # Reason: Keep minimal provenance
    provenance: {
      requestId,
      auth: { email: (callerEmail || INTERNAL_PUBLISHER_AUDIT_EMAIL).toLowerCase() },
      payloadVersion: validPayload.version,
    },
    lastEnqueuedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  // Publish to Pub/Sub
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

  const messageId = await publishToPubSub(validPayload, attributes);

  await runRef.set({
    status: 'enqueued',
    enqueuedAt: FieldValue.serverTimestamp(),
    pubsubMessageId: messageId,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true, requestId, messageId, status: 'enqueued' };
}

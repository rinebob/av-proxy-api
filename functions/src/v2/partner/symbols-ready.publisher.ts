import { PARTNER_SYMBOLS_READY_TOPIC } from './constants';
import { betterLogger, type BetterLogPayload } from '../utils/utils';

export interface SymbolsReadyPayloadV1 {
  version: 'v1';
  marketDate: string; // YYYY-MM-DD
  symbols: string[];
  runId?: string;
  reason?: 'scheduled' | 'backfill';
  // Interval label so partners know which endpoint to hit, e.g. DAILY/WEEKLY/MONTHLY
  interval: string;
  publishedAtUTC?: string;
}

/**
 * Internal Pub/Sub publisher for symbol-level readiness notifications.
 * Publishes batched symbol lists to topic `partner-symbols-ready`.
 *
 * Logging: uses betterLogger with file abbrev 'sR.P' (symbols-ready.publisher.ts)
 * and function abbrev 'pSRB' (publishSymbolsReadyBatch) for human-readable lines.
 */
const logger = betterLogger('sR.P');

export async function publishSymbolsReadyBatch(
  payload: SymbolsReadyPayloadV1,
  attributes?: Record<string, string>,
): Promise<string | undefined> {
  if (!payload.symbols.length) {
    return undefined;
  }

  // Lazy import to avoid bringing dependency into cold path if not used during tests.
  const { PubSub } = await import('@google-cloud/pubsub');
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT;
  const pubsub = projectId ? new PubSub({ projectId }) : new PubSub();
  const topicName = PARTNER_SYMBOLS_READY_TOPIC;
  const topic = pubsub.topic(topicName);

  const jsonPayload: SymbolsReadyPayloadV1 = {
    ...payload,
    version: 'v1',
    publishedAtUTC: payload.publishedAtUTC || new Date().toISOString(),
  };

  const attrs: Record<string, string> = {
    marketDate: jsonPayload.marketDate,
    ...(jsonPayload.runId ? { runId: jsonPayload.runId } : {}),
    ...(jsonPayload.reason ? { reason: jsonPayload.reason } : {}),
    ...(attributes || {}),
  };

  try {
    const messageId = await topic.publishMessage({ json: jsonPayload, attributes: attrs });
    try {
      const baseLogPayload: BetterLogPayload = {
        function: 'pSRB',
        symbol:
          jsonPayload.symbols.length === 1
            ? jsonPayload.symbols[0]
            : jsonPayload.symbols.join(','),
        marketDate: jsonPayload.marketDate,
        interval: jsonPayload.interval || 'n/a',
        endpoint: 'SYMBOLS_READY',
      };
      logger.info('symbols.ready.publish', baseLogPayload);
    } catch {}
    return messageId;
  } catch (err: any) {
    const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true' || !!process.env.PUBSUB_EMULATOR_HOST;
    if (isEmulator && (err?.code === 5 || (typeof err?.message === 'string' && err.message.includes('NOT_FOUND')))) {
      try {
        await pubsub.createTopic(topicName);
      } catch (createErr: any) {
        if (createErr?.code !== 6) {
          throw err;
        }
      }
      return await topic.publishMessage({ json: jsonPayload, attributes: attrs });
    }
    throw err;
  }
}

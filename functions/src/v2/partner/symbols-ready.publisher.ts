import { PARTNER_SYMBOLS_READY_TOPIC } from './constants';
import { betterLogger, type BetterLogPayload } from '../utils/utils';
import { publishMessageToTopic } from './pubsub-message.publisher';

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

  const messageId = await publishMessageToTopic({
    topicName: PARTNER_SYMBOLS_READY_TOPIC,
    payload: jsonPayload,
    attributes: attrs,
  });

  try {
    const baseLogPayload: BetterLogPayload = {
      function: 'pSRB',
      symbol:
        jsonPayload.symbols.length === 1
          ? jsonPayload.symbols[0]
          : jsonPayload.symbols.join(','),
      marketDate: jsonPayload.marketDate,
      interval: jsonPayload.interval || 'n/a',
    };
    logger.info('symbols.ready.publish', baseLogPayload);
  } catch {}

  return messageId;
}

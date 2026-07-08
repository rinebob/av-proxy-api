import { PARTNER_SYMBOL_ADDED_TOPIC } from './constants';
import { betterLogger, type BetterLogPayload } from '../utils/utils';
import { publishMessageToTopic } from './pubsub-message.publisher';
import {
  validateSymbolAddedPayload,
  type SymbolAddedPayloadV1,
} from './schemas/symbol-added.schema';

export type { SymbolAddedPayloadV1 };

/**
 * Internal Pub/Sub publisher for tracked-symbol onboarding completion.
 * Publishes to topic `partner-symbol-added` when a newly tracked symbol has
 * finished its initial DAILY/WEEKLY/MONTHLY backfill in the SA project.
 *
 * Logging: uses betterLogger with file abbrev 'sA.P' (symbol-added.publisher.ts)
 * and function abbrev 'pSAB' (publishSymbolAddedBatch) for human-readable lines.
 */
const logger = betterLogger('sA.P');

export async function publishSymbolAddedBatch(
  payload: SymbolAddedPayloadV1,
  attributes?: Record<string, string>,
): Promise<string | undefined> {
  if (!payload.symbols.length) {
    return undefined;
  }

  const jsonPayload: SymbolAddedPayloadV1 = {
    ...payload,
    version: 'v1',
    addedAtUTC: payload.addedAtUTC || new Date().toISOString(),
  };

  validateSymbolAddedPayload(jsonPayload);

  const attrs: Record<string, string> = {
    status: jsonPayload.status,
    version: jsonPayload.version,
    ...(attributes || {}),
  };

  const messageId = await publishMessageToTopic({
    topicName: PARTNER_SYMBOL_ADDED_TOPIC,
    payload: jsonPayload,
    attributes: attrs,
  });

  try {
    const baseLogPayload: BetterLogPayload = {
      function: 'pSAB',
      symbol:
        jsonPayload.symbols.length === 1
          ? jsonPayload.symbols[0]
          : jsonPayload.symbols.join(','),
      interval: jsonPayload.availableIntervals.join(','),
    };
    logger.info('symbol.added.publish', baseLogPayload);
  } catch {}

  return messageId;
}

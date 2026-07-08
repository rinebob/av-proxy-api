/**
 * Canonical, low-level Pub/Sub message publisher for partner-facing topics.
 *
 * Responsibilities:
 * - Lazy-load the @google-cloud/pubsub client.
 * - Publish a JSON payload with optional attributes.
 * - Auto-create the topic in the emulator if it does not exist, then retry once.
 *
 * Higher-level publishers (e.g. symbol-added.publisher.ts) should own the
 * payload contract, attributes, and logging; they call this helper for the
 * raw Pub/Sub transport.
 */

export interface PublishMessageOptions {
  topicName: string;
  payload: unknown;
  attributes?: Record<string, string>;
}

/**
 * Publishes a JSON message to a Pub/Sub topic.
 *
 * @param options.topicName Topic name (short form, e.g. 'partner-symbol-added').
 * @param options.payload Serializable JSON payload.
 * @param options.attributes Optional message attributes for routing/filtering.
 * @returns The Pub/Sub message ID.
 */
export async function publishMessageToTopic(options: PublishMessageOptions): Promise<string> {
  const { topicName, payload, attributes } = options;

  const { PubSub } = await import('@google-cloud/pubsub');
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT;
  const pubsub = projectId ? new PubSub({ projectId }) : new PubSub();
  const topic = pubsub.topic(topicName);

  const message = {
    json: payload,
    ...(attributes ? { attributes } : {}),
  };

  try {
    return await topic.publishMessage(message);
  } catch (err: any) {
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
      return await topic.publishMessage(message);
    }
    throw err;
  }
}

/**
 * Shared Alpha Vantage throttle abstraction.
 *
 * Enforces a minimum interval between consecutive AV calls. This is used by
 * both the retrieval seam and the seed worker to stay safely within provider
 * rate limits when running inside a single process. Cloud Tasks queue
 * rate limits provide cross-invocation throttling in production.
 */

export interface AvThrottle {
  wait(): Promise<void>;
}

/** No-op throttle for unit tests and dry-run planning. */
export class NoOpAvThrottle implements AvThrottle {
  async wait(): Promise<void> {
    // no delay
  }
}

/** Throttle that sleeps until `minIntervalMs` has elapsed since the last call. */
export class FixedIntervalAvThrottle implements AvThrottle {
  private lastRequestTime = 0;

  constructor(private readonly minIntervalMs: number) {}

  async wait(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    const delay = Math.max(0, this.minIntervalMs - elapsed);
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    this.lastRequestTime = Date.now();
  }
}

/** Default interval keeps the corpus at 60 calls/minute, under the 75 req/min limit. */
const DEFAULT_ALPHAVANTAGE_INTERVAL_MS = 1_000;

/**
 * Creates the runtime throttle. The interval may be overridden with
 * `ALPHAVANTAGE_MIN_INTERVAL_MS` for testing or premium tiers.
 */
export function getDefaultAvThrottle(): AvThrottle {
  const raw = process.env.ALPHAVANTAGE_MIN_INTERVAL_MS;
  const parsed = raw ? Number(raw) : DEFAULT_ALPHAVANTAGE_INTERVAL_MS;
  const interval = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ALPHAVANTAGE_INTERVAL_MS;
  return new FixedIntervalAvThrottle(interval);
}

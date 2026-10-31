import type { Firestore } from 'firebase-admin/firestore';

/**
 * Per-symbol mutual exclusion for ts-build tasks.
 *
 * The Cloud Tasks queue dispatches concurrently across different symbols
 * (maxConcurrentDispatches > 1), but two tasks building the SAME symbol
 * would race on read-modify-write of the same per-contract JSONL files
 * and silently drop observations. A short-lived Firestore lease serializes
 * same-symbol work: the contender re-enqueues itself with a delay instead
 * of proceeding.
 */
const LEASE_COLLECTION = 'options-ts-build-leases';
const DEFAULT_LEASE_TTL_MS = 20 * 60 * 1000;

export interface TsBuildLeaseDoc {
  symbol: string;
  lockedUntil: number;
  acquiredAt: string;
  /** Last date the holder's build covers — lets producers skip only
   *  genuinely-covered work instead of any work while the lease is held. */
  coveredUntil?: string;
}

/** Pure check: does this lease doc prove `date` is covered by the holder's
 *  build? Requires a live lease AND a recorded coveredUntil at-or-after the
 *  date. Legacy docs without coveredUntil never count as covering. */
export function leaseCoversDate(
  lease: { lockedUntil?: unknown; coveredUntil?: unknown } | undefined,
  date: string,
  nowMs: number,
): boolean {
  if (!lease) return false;
  if (Number(lease.lockedUntil ?? 0) <= nowMs) return false;
  const coveredUntil = lease.coveredUntil;
  if (typeof coveredUntil !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(coveredUntil)) return false;
  return date <= coveredUntil;
}

/**
 * Attempts to acquire the lease for `symbol`. Returns true when acquired.
 * An expired lease (holder crashed or timed out) is treated as free and
 * taken over — the TTL must exceed the function timeout so a live holder
 * never appears expired. `coveredUntil` records the build's end date so
 * producers can distinguish "held for a range that covers my date" from
 * "held for an unrelated span".
 */
export async function acquireTsBuildLease(
  db: Firestore,
  symbol: string,
  ttlMs: number = DEFAULT_LEASE_TTL_MS,
  coveredUntil?: string,
): Promise<boolean> {
  const ref = db.collection(LEASE_COLLECTION).doc(symbol.toUpperCase());
  const now = Date.now();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const lockedUntil = Number(snap.data()?.lockedUntil ?? 0);
      if (lockedUntil > now) {
        return false;
      }
    }
    tx.set(ref, {
      symbol: symbol.toUpperCase(),
      lockedUntil: now + ttlMs,
      acquiredAt: new Date(now).toISOString(),
      ...(coveredUntil ? { coveredUntil } : {}),
    });
    return true;
  });
}

/** Releases the lease. Best-effort: a lingering doc self-expires via TTL. */
export async function releaseTsBuildLease(db: Firestore, symbol: string): Promise<void> {
  try {
    await db.collection(LEASE_COLLECTION).doc(symbol.toUpperCase()).delete();
  } catch {
    // Swallow — the lease TTL makes a failed delete self-healing.
  }
}

/**
 * Cheap non-transactional check: is a ts-build task currently holding this
 * symbol's lease? Kept for callers that need raw held state.
 */
export async function isTsBuildLeaseHeld(db: Firestore, symbol: string): Promise<boolean> {
  const snap = await db.collection(LEASE_COLLECTION).doc(symbol.toUpperCase()).get();
  if (!snap.exists) return false;
  return Number(snap.data()?.lockedUntil ?? 0) > Date.now();
}

/**
 * Cheap non-transactional check: does a held lease's build already cover
 * `date`? Producers (seed worker) skip enqueueing single-date builds only
 * when this is true — lease-held alone must NOT suppress work the holder's
 * range doesn't include (Topic #213: post-range dates starved while a
 * bounded range build held the lease for weeks).
 */
export async function isTsBuildDateCovered(db: Firestore, symbol: string, date: string): Promise<boolean> {
  const snap = await db.collection(LEASE_COLLECTION).doc(symbol.toUpperCase()).get();
  if (!snap.exists) return false;
  return leaseCoversDate(snap.data(), date, Date.now());
}

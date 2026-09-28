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

/**
 * Attempts to acquire the lease for `symbol`. Returns true when acquired.
 * An expired lease (holder crashed or timed out) is treated as free and
 * taken over — the TTL must exceed the function timeout so a live holder
 * never appears expired.
 */
export async function acquireTsBuildLease(
  db: Firestore,
  symbol: string,
  ttlMs: number = DEFAULT_LEASE_TTL_MS,
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
 * symbol's lease? Used by producers (seed worker) to skip enqueueing
 * single-date builds a range build already covers.
 */
export async function isTsBuildLeaseHeld(db: Firestore, symbol: string): Promise<boolean> {
  const snap = await db.collection(LEASE_COLLECTION).doc(symbol.toUpperCase()).get();
  if (!snap.exists) return false;
  return Number(snap.data()?.lockedUntil ?? 0) > Date.now();
}

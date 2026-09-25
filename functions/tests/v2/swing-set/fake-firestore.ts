/**
 * Shared in-memory Firestore fake for swing-set tests.
 *
 * Covers the FirestoreLike surface the swing-set module uses:
 * collection(path).doc(id).{set,get,delete}, collection(path).where(f,op,v).get(),
 * collection(path).get(). Seed docs via `seed` keyed by `collection/docId`.
 * `calls` records every set() for write-path/merge-option assertions.
 *
 * NOTE: set() honors opts.merge (merge → shallow top-level merge, absent →
 * full replace). Real Firestore deep-merges map fields — irrelevant for
 * full-doc writes. `where()` only implements `==`.
 */
import { Timestamp } from 'firebase-admin/firestore';
import type { FirestoreLike } from '../../../src/v2/common/firestore/firestore-like';

function resolveArrayUnionElement(value: unknown): unknown {
  if (value?.constructor?.name === 'ServerTimestampTransform') {
    throw new Error('serverTimestamp() cannot be used inside an arrayUnion element');
  }
  if (value instanceof Timestamp || value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(resolveArrayUnionElement);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveArrayUnionElement(item)]));
  }
  return value;
}

export function createFakeFirestore(seed: Record<string, unknown> = {}): FirestoreLike & {
  calls: { method: string; path: string; payload?: unknown; opts?: unknown }[];
  store: Map<string, unknown>;
} {
  const store = new Map<string, unknown>(Object.entries(seed));
  const calls: { method: string; path: string; payload?: unknown; opts?: unknown }[] = [];

  const fakeDb = {
    calls,
    store,
    collection(path: string) {
      return {
        doc(id: string) {
          return {
            async set(payload: unknown, opts?: unknown) {
              calls.push({ method: 'set', path: `${path}/${id}`, payload, opts });
              const merge = (opts as { merge?: boolean } | undefined)?.merge === true;
              const existing = merge ? (store.get(`${path}/${id}`) ?? {}) : {};
              const next: Record<string, unknown> = { ...(existing as object) };
              for (const [k, v] of Object.entries(payload as object)) {
                if (v?.constructor?.name === 'DeleteTransform') {
                  delete next[k];
                } else if (v?.constructor?.name === 'ServerTimestampTransform') {
                  next[k] = Timestamp.now();
                } else if (v?.constructor?.name === 'ArrayUnionTransform') {
                  const elements = (v as { elements: unknown[] }).elements.map(resolveArrayUnionElement);
                  const current = Array.isArray(next[k]) ? (next[k] as unknown[]) : [];
                  next[k] = [...current, ...elements.filter((element) =>
                    !current.some((item) => JSON.stringify(item) === JSON.stringify(element)),
                  )];
                } else {
                  next[k] = v;
                }
              }
              store.set(`${path}/${id}`, next);
            },
            async get() {
              const data = store.get(`${path}/${id}`);
              return { exists: data !== undefined, data: () => data, id };
            },
            async delete() {
              store.delete(`${path}/${id}`);
            },
          };
        },
        where(field: string, _op: string, value: unknown) {
          return {
            async get() {
              const docs = [...store.entries()]
                .filter(([k]) => k.startsWith(`${path}/`))
                .filter(([, v]) => (v as Record<string, unknown>)[field] === value)
                .map(([k, v]) => ({ exists: true, id: k.slice(path.length + 1), data: () => v }));
              return { docs, empty: docs.length === 0, size: docs.length };
            },
          };
        },
        async get() {
          const docs = [...store.entries()]
            .filter(([k]) => k.startsWith(`${path}/`))
            .map(([k, v]) => ({ exists: true, id: k.slice(path.length + 1), data: () => v }));
          return { docs, empty: docs.length === 0, size: docs.length };
        },
      };
    },
  };
  return fakeDb;
}

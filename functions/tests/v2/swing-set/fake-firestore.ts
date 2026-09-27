/**
 * Shared in-memory Firestore fake for swing-set tests.
 *
 * Covers the FirestoreLike surface the swing-set module uses:
 * collection(path).doc(id).{set,get,delete}, collection(path).where(f,op,v).get(),
 * collection(path).get(). Seed docs via `seed` keyed by `collection/docId`.
 * `calls` records every set() for write-path/merge-option assertions.
 *
 * NOTE: set() honors opts.merge — merge:true deep-merges nested plain-object
 * maps recursively (matching real Firestore merge semantics); absent merge is
 * a full replace. `mergeFields: string[]` applies each listed dot-path as a
 * point write (the path's value replaces wholesale; unlisted fields
 * untouched). `where()` only implements `==`.
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

/** Is this a plain JSON-shaped map (not a Firestore transform/Timestamp/array)? */
function isPlainMap(v: unknown): v is Record<string, unknown> {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) return false;
  const name = v.constructor?.name;
  return name === 'Object' || name === undefined;
}

/** Deep-merge payload into existing per real Firestore set(merge:true):
 *  nested plain-object maps union recursively; transforms resolve;
 *  non-map values replace. */
function mergeInto(existing: Record<string, unknown>, payload: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...existing };
  for (const [k, v] of Object.entries(payload)) {
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
    } else if (isPlainMap(v) && isPlainMap(next[k])) {
      next[k] = mergeInto(next[k] as Record<string, unknown>, v);
    } else {
      next[k] = v;
    }
  }
  return next;
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
              const key = `${path}/${id}`;
              const options = opts as { merge?: boolean; mergeFields?: string[] } | undefined;
              if (options?.mergeFields) {
                // Point-writes at the listed dot-paths only — replaces each
                // path's value wholesale, leaves unlisted fields untouched.
                const next = { ...((store.get(key) ?? {}) as Record<string, unknown>) };
                for (const fieldPath of options.mergeFields) {
                  const segs = fieldPath.split('.');
                  const value = segs.reduce<unknown>(
                    (o, k) => (o as Record<string, unknown> | undefined)?.[k],
                    payload,
                  );
                  // Real Firestore errors when a mergeField is absent from data
                  if (value === undefined) {
                    throw new Error(`fake-firestore: mergeField '${fieldPath}' absent from set() payload`);
                  }
                  let node = next;
                  for (let i = 0; i < segs.length - 1; i++) {
                    const k = segs[i];
                    // copy-on-write each level so the stored object tree
                    // isn't mutated in place (shared fixture safety)
                    const child = isPlainMap(node[k]) ? { ...node[k] } : {};
                    node[k] = child;
                    node = child;
                  }
                  const leaf = segs[segs.length - 1];
                  if (value?.constructor?.name === 'ServerTimestampTransform') {
                    node[leaf] = Timestamp.now();
                  } else {
                    node[leaf] = value;
                  }
                }
                store.set(key, next);
              } else {
                const existing = options?.merge === true
                  ? ((store.get(key) ?? {}) as Record<string, unknown>)
                  : {};
                store.set(key, mergeInto(existing, payload as Record<string, unknown>));
              }
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

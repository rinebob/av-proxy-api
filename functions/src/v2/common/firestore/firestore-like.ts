/**
 * Minimal structural Firestore interfaces for services that take an injected
 * db handle. `firebase-admin`'s `Firestore` satisfies these structurally, and
 * tests can pass plain-object fakes with no type-erasing casts.
 */

export interface DocSnapshotLike {
  readonly exists: boolean;
  readonly id: string;
  data(): unknown;
}

export interface DocRefLike {
  get(): Promise<DocSnapshotLike>;
  set(data: unknown, opts?: { merge?: boolean }): Promise<unknown>;
  delete(): Promise<unknown>;
}

export interface QuerySnapshotLike {
  readonly docs: DocSnapshotLike[];
  readonly empty: boolean;
  readonly size: number;
}

export interface QueryLike {
  get(): Promise<QuerySnapshotLike>;
}

export interface CollectionLike extends QueryLike {
  doc(id: string): DocRefLike;
  where(field: string, op: string, value: unknown): QueryLike;
}

export interface FirestoreLike {
  collection(path: string): CollectionLike;
}

// COPIED FROM src/app/feat/bz-calendar-view/common/fe-common-bz-api.ts. Do not use directly until migration is complete.

import { FirestoreTimestamp } from "./bz-types";

/**
 * News data structure
 */
export interface BzNewsData {
  id: number;
  author: string;
  created: string;
  updated: string;
  title: string;
  teaser: string;
  body: string;
  url: string;
  image: Array<{ size: string; url: string }>;
  channels: Array<{ name: string }>;
  stocks: Array<{ name: string }>;
  tags: Array<{ name: string }>;
}

export interface SvtBenzingaNewsItem {
  id: string;
  author: string;
  title: string;
  teaser: string;
  body: string;
  url: string;
  imageUrls: Record<string, string>;
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
  savedAt: FirestoreTimestamp;
  stocks: string[];
  channels: string[];
  tags: string[];
  /**
   * [FIRESTORE TTL POLICY]
   * This field is used by Firestore's automatic TTL (Time-to-Live) deletion policy.
   *
   * When set, Firestore will automatically delete this document after the specified timestamp.
   *
   * Example Firestore TTL policy output:
   *
   * {
   *   "name": "projects/PROJECT_ID/databases/(default)/collectionGroups/news/fields/ttl",
   *   "ttlConfig": {
   *     "state": "ACTIVE"
   *   }
   * }
   *
   * $ gcloud firestore fields ttls list --database="(default)" --project="alpha-vantage-proxy-api"
   * name: projects/alpha-vantage-proxy-api/databases/(default)/collectionGroups/news/fields/ttl
   * ttlConfig:
   *   state: ACTIVE
   *
   * https://console.cloud.google.com/firestore/databases/-default-/ttl?chat=true&inv=1&invt=Ab4mxA&project=alpha-vantage-proxy-api
   *
   * @see https://firebase.google.com/docs/firestore/ttl
   */
  ttl?: FirestoreTimestamp;
}

import { Timestamp } from 'firebase-admin/firestore';
import { ApiProvider } from './data-providers';

export interface DocumentPathOptions {
  vendor: ApiProvider;
  endpoint: string;
  symbol?: string;
}

export type RefreshStatus = 'SUCCESS' | 'FAILURE';
export type RefreshTrigger = 'scheduler' | 'manual' | 'retry' | 'api' | 'system';

/**
 * A detailed record of a single refresh event, used for both the
 * last refresh and the historical log.
 */
export interface RefreshEvent {
  eventId: string;
  triggeredBy: RefreshTrigger;
  refreshedAt: Timestamp;
  refreshedBy: string; // The name of the request/endpoint that ran the refresh
  durationMs: number;
  nextRefreshAt: Timestamp;
  nextRefreshBy: string; // The name of the request/endpoint scheduled to refresh next
  ttlHuman: string; // Human-readable TTL (e.g., '4 hours', '2 days')
  status: RefreshStatus;
  errorDetails: string | null;
  httpStatus?: number;
}

/**
 * The standard structure for documents containing API data.
 * It pairs the data payload with the flattened refresh metadata.
 */
export interface DataDocument<T = any> {
  data: T | null; // Data can be null in case of a refresh failure
  refreshHistory: RefreshEvent[];
}

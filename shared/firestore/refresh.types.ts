import { ApiProvider } from '../core';
import type { TimestampLike } from './timestamp';

export interface DocumentPathOptions {
  vendor: ApiProvider;
  endpoint: string;
  symbol?: string;
}

export enum RefreshStatus {
  SUCCESS = 'SUCCESS',
  FAILURE = 'FAILURE'
}

/**
 * A detailed record of a single refresh event, used for both the
 * last refresh and the historical log.
 */
export enum RefreshTrigger {
  SCHEDULER = 'scheduler',
  MANUAL = 'manual',
  RETRY = 'retry',
  API = 'api',
  SYSTEM = 'system',
  SYMBOL_ADDED = 'symbol-added',
  AV_REFRESH_MANAGER = 'av-refresh-manager',
  BACKFILL_SCRIPT = 'backfill-script',
  UPDATER_MANUAL = 'updater-manual'
}

export interface RefreshEvent {
  eventId: string;
  triggeredBy: RefreshTrigger;
  refreshedAt: TimestampLike;
  refreshedBy: string; // The name of the request/endpoint that ran the refresh
  durationMs: number;
  nextRefreshAt: TimestampLike;
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

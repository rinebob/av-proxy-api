import { Timestamp } from 'firebase-admin/firestore';

export type VendorType = 'av' | 'bz';

export interface DocumentPathOptions {
  vendor: VendorType;
  endpoint: string;
  symbol?: string;
}

export interface RefreshEvent {
  timestamp: Timestamp;
  status: 'success' | 'failure' | 'pending' | 'retry';
  durationMs: number;
  httpStatus?: number;
  responseSize?: number;
  error?: string | null;
  triggeredBy: 'scheduler' | 'manual' | 'retry' | 'api' | 'system';
  instanceId: string;
  region: string;
  endpoint: string;
  vendor: VendorType;
  symbol?: string;
  endpointParams?: {
    ttlSeconds?: number;
    [key: string]: any;
  };
  metadata?: Record<string, any>;
}

export interface RefreshMetadata {
  lastUpdated: Timestamp;
  nextRefreshAt: Timestamp;
  ttlSeconds: number;
  vendor: VendorType;
  endpoint: string;
  symbol?: string;
  lastRefreshEvent: {
    timestamp: Timestamp;
    status: 'success' | 'failure' | 'pending' | 'retry';
    durationMs: number;
    error: string | null;
  };
}

export interface DataDocument<T = any> {
  data: T;
  metadata: RefreshMetadata;
}

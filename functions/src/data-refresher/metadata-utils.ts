import { FieldValue } from 'firebase-admin/firestore';

export interface RefreshMetadata {
  lastRefreshEvent: {
    timestamp: Date | FieldValue;
    status: 'success' | 'failure';
    durationMs: number;
    error: string | null;
  };
  metadata: {
    endpoint: string;
    symbol?: string;
    nextRefreshAt: Date | FieldValue;
    nextRefreshAtPST: string;
    nextRefreshedBy: string;
    lastRefreshedAt: Date | FieldValue;
    lastRefreshedAtPST: string;
    lastRefreshedBy: string;
    lastRefreshId?: string;
  };
  data?: any;
}

export function createMetadataDocument(
  endpoint: string,
  symbol: string | undefined,
  durationMs: number,
  status: 'success' | 'failure',
  error: string | null = null,
  data: any = null,
  config: { ttl: number; requestId?: string; id: string }
): RefreshMetadata {
  const now = new Date();
  const ttl = config.ttl; // TTL should always be provided in the config
  const nextRefreshAt = new Date(now.getTime() + ttl * 1000);
  const PST_TZ = 'America/Los_Angeles';
  
  const formatPST = (date: Date) => date.toLocaleString('en-US', { timeZone: PST_TZ });

  return {
    data,
    lastRefreshEvent: {
      timestamp: FieldValue.serverTimestamp(),
      status,
      durationMs,
      error,
    },
    metadata: {
      endpoint,
      ...(symbol && { symbol }), // Only include symbol if provided
      nextRefreshAt: FieldValue.serverTimestamp(),
      nextRefreshAtPST: formatPST(nextRefreshAt),
      nextRefreshedBy: config.id,
      lastRefreshedAt: FieldValue.serverTimestamp(),
      lastRefreshedAtPST: formatPST(now),
      lastRefreshedBy: config.id,
      lastRefreshId: config.requestId,
    },
  };
}

import { RefreshStatus } from '../firestore';
import type { TimestampLike } from '../firestore/timestamp';

// Enums replace prior string literal unions
export enum HealthStatus {
  Healthy = 'healthy',
  Degraded = 'degraded',
  Error = 'error',
  Offline = 'offline',
}

export enum RefreshRecency {
  Fresh = 'fresh',
  Stale = 'stale',
  Never = 'never',
  Error = 'error',
}

export enum RefreshTrigger {
  Scheduled = 'scheduled',
  Manual = 'manual',
  Retry = 'retry',
  Api = 'api',
}

export enum HealthMetricsSortBy {
  Timestamp = 'timestamp',
  LastUpdated = 'lastUpdated',
  Symbol = 'symbol',
  Status = 'status',
  Duration = 'duration',
}

export enum SortOrder {
  Asc = 'asc',
  Desc = 'desc',
}

export enum SymbolHealthState {
  Success = 'success',
  Error = 'error',
  Stale = 'stale',
  Pending = 'pending',
  Unknown = 'unknown',
}

export interface SymbolRefreshMetrics {
  symbol: string;
  endpointId: string;
  lastUpdated: Date | TimestampLike;
  lastStatus: RefreshStatus;
  lastError?: string;
  refreshCount: number;
  successCount: number;
  failureCount: number;
  totalDurationMs: number;
  avgDurationMs: number;
  firstSeen: Date | TimestampLike;
  lastSeen: Date | TimestampLike;
}

export interface EndpointHealthMetrics {
  endpointId: string;
  endpointName: string;
  ttlSeconds: number;
  lastUpdated?: Date | TimestampLike;
  nextRefreshAt?: Date | TimestampLike;
  refreshStatus: RefreshRecency;
  lastRefreshAttempt?: Date | TimestampLike;
  lastRefreshStatus?: RefreshStatus;
  error?: string;
  
  // UI-specific fields
  healthStatus: HealthStatus;
  uptimePercentage: number; // 0-100
  
  // Time series data for charts
  requestHistory: {
    timestamp: Date | TimestampLike;
    count: number;
    avgDuration: number;
    errorCount: number;
  }[];
  
  // Aggregated metrics
  metrics: {
    totalRequests: number;
    requestRatePerMinute: number;
    errorRate: number;
    avgResponseTime: number;
    p95ResponseTime: number;
  };
  
  // Symbol-level metrics
  symbols: {
    total: number;
    fresh: number;
    stale: number;
    error: number;
    lastUpdated: Date | TimestampLike;
  };
}

export interface RefreshRequestLog {
  id: string;
  timestamp: Date | TimestampLike;
  endpointId: string;
  symbol?: string;
  status: RefreshStatus;
  durationMs: number;
  error?: string;
  responseSize?: number;
  metadata?: {
    trigger?: RefreshTrigger;
    userId?: string;
    userAgent?: string;
    ipAddress?: string;
    [key: string]: any;
  };
}

export interface SymbolStatus {
  symbol: string;
  endpointId: string;
  status: SymbolHealthState;
  lastUpdated: Date | TimestampLike;
  updatedAt: Date | TimestampLike;
  lastError?: string;
  refreshCount: number;
  successRate: number;
  avgDurationMs: number;
  lastDurationMs?: number;
  nextScheduledRefresh?: Date | TimestampLike;
}

// Types for UI filtering
export interface HealthMetricsFilter {
  timeRange?: {
    from: Date | TimestampLike;
    to: Date | TimestampLike;
  };
  status?: HealthStatus[];
  endpointIds?: string[];
  symbols?: string[];
  searchQuery?: string;
  sortBy?: HealthMetricsSortBy;
  sortOrder?: SortOrder;
  limit?: number;
  offset?: number;
}

// Response types for API
export interface HealthMetricsResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

// Types for dashboard widgets
export interface HealthSummary {
  totalEndpoints: number;
  healthyEndpoints: number;
  errorEndpoints: number;
  degradedEndpoints: number;
  totalSymbols: number;
  errorSymbols: number;
  staleSymbols: number;
  lastUpdated: Date | TimestampLike;
  recentErrors: Array<{
    id: string;
    timestamp: Date | TimestampLike;
    endpointId: string;
    symbol?: string;
    error: string;
  }>;
}

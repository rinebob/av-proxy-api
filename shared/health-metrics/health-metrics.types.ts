import { RefreshStatus, RefreshTrigger } from '../firestore';
import type { TimestampLike } from '../firestore/timestamp';
import type { AlphaVantageEndpoint, DayOfWeek } from '../alpha-vantage';

// Shared TradingPhase for runs (matches scheduler semantics)
export enum TradingPhase {
  PRE = 'pre',
  POST = 'post',
}

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
    // Run grouping metadata (optional). When present, the UI can group rows by runId.
    runId?: string;
    run?: {
      id: string;              // same as runId
      date: string;            // ET YYYY-MM-DD
      dow: DayOfWeek;          // MON/TUE/...
      phase: TradingPhase;     // pre/post
      endpointId: AlphaVantageEndpoint; // AlphaVantageEndpoint value
      endpointShort?: string;  // e.g., TS_DAILY_ADJ
      trigger: RefreshTrigger; // MANUAL/SCHEDULER/etc.
      [key: string]: any;
    };
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

// ================= UI Enums/Types =================
// Direction used across UI sorting
export enum SortDir {
  ASC = 'asc',
  DESC = 'desc',
}

// Group sort modes for Symbol and Endpoint detail panels
export enum SymbolGroupSortMode {
  ALPHA = 'alpha',
  RECENT = 'recent',
}

export enum EndpointGroupSortMode {
  PRIORITY = 'priority',
  ALPHA = 'alpha',
  RECENT = 'recent',
}

// Sortable keys for Request Logs and detail tables
export enum SortKey {
  TIMESTAMP = 'timestamp',
  SYMBOL = 'symbol',
  ENDPOINT_ID = 'endpointId',
  STATUS = 'status',
  DURATION_MS = 'durationMs',
  RESPONSE_SIZE = 'responseSize',
}

export enum FilterType {
  SYMBOL = 'symbol',
  ENDPOINT = 'endpoint',
  STATUS = 'status',
  TIME_RANGE = 'timeRange',
}

export interface FilterOption {
  label: string;
  value: string;
}

export interface FilterConfig {
  type: FilterType;
  options?: FilterOption[];
  placeholder?: string;
}

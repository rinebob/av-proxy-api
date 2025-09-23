import { db } from '../../firebase-admin-init';
import { 
  AlphaVantageEndpoint, 
  AV_ENDPOINT_CONFIGS, 
  AV_TIME_SERIES_ENDPOINT_CONFIGS 
} from '@shared/alpha-vantage';
import { FirestoreCollection, RefreshStatus } from '@shared/firestore';
import { 
  EndpointHealthMetrics,
  RefreshRequestLog, 
  SymbolRefreshMetrics,
  SymbolStatus,
  HealthSummary,
  HealthMetricsFilter,
  HealthMetricsResponse
} from '@shared/health-metrics';

export class HealthMetricsService {
  private readonly DEFAULT_LIMIT = 100;
  private readonly MAX_LIMIT = 1000;

  async getEndpointHealth(endpointId: AlphaVantageEndpoint): Promise<EndpointHealthMetrics> {
    // Get the latest refresh history for this endpoint
    const historyRef = db
      .collection(FirestoreCollection.HEALTH_METRICS)
      .doc(endpointId)
      .collection('history')
      .orderBy('timestamp', 'desc')
      .limit(1);
    
    const snapshot = await historyRef.get();
    const latest = snapshot.docs[0]?.data();
    
    // Get the endpoint config
    const config = this.getEndpointConfig(endpointId);
    
    // Initialize with default values for all required fields
    const healthMetrics: EndpointHealthMetrics = {
      endpointId,
      endpointName: config.name,
      ttlSeconds: config.ttl || 0,
      refreshStatus: this.calculateRefreshStatus(latest?.nextRefreshAt?.toDate(), config.ttl),
      healthStatus: 'healthy',
      uptimePercentage: 100,
      requestHistory: [],
      metrics: {
        totalRequests: 0,
        requestRatePerMinute: 0,
        errorRate: 0,
        avgResponseTime: 0,
        p95ResponseTime: 0
      },
      symbols: {
        total: 0,
        fresh: 0,
        stale: 0,
        error: 0,
        lastUpdated: new Date()
      }
    };

    // Update with latest data if available
    if (latest) {
      healthMetrics.lastUpdated = latest.lastUpdated?.toDate();
      healthMetrics.nextRefreshAt = latest.nextRefreshAt?.toDate();
      healthMetrics.lastRefreshAttempt = latest.timestamp?.toDate();
      healthMetrics.lastRefreshStatus = latest.status;
      healthMetrics.error = latest.error;
    }
    
    return healthMetrics;
  }

  private getEndpointConfig(endpointId: AlphaVantageEndpoint) {
    // First check time series configs
    const timeSeriesConfig = AV_TIME_SERIES_ENDPOINT_CONFIGS[endpointId as keyof typeof AV_TIME_SERIES_ENDPOINT_CONFIGS];
    if (timeSeriesConfig) {
      return timeSeriesConfig;
    }
    
    // Then check regular endpoint configs
    const endpointConfig = AV_ENDPOINT_CONFIGS[endpointId as keyof typeof AV_ENDPOINT_CONFIGS];
    if (endpointConfig) {
      return endpointConfig;
    }
    
    throw new Error(`No configuration found for endpoint: ${endpointId}`);
  }
  
  private calculateRefreshStatus(nextRefreshAt?: Date, ttlSeconds?: number): 'fresh' | 'stale' | 'never' | 'error' {
    if (!nextRefreshAt) return 'never';
    const now = new Date();
    return now < nextRefreshAt ? 'fresh' : 'stale';
  }

  /**
   * Records a refresh attempt for an endpoint
   * @param endpointId The endpoint that was refreshed
   * @param symbol The symbol that was refreshed
   * @param status Whether the refresh was successful
   * @param error Optional error message if the refresh failed
   * @param refreshDurationMs How long the refresh took in milliseconds
   */
  async recordRefreshAttempt(
    endpointId: AlphaVantageEndpoint,
    status: RefreshStatus,
    error?: string,
    refreshDurationMs?: number
  ): Promise<void> {
    const batch = db.batch();
    const now = new Date();
    
    // Get the endpoint config to determine TTL
    const config = this.getEndpointConfig(endpointId);
    const nextRefreshAt = new Date(now.getTime() + (config.ttl || 0) * 1000);
    
    // Create a new history entry
    const historyRef = db
      .collection(FirestoreCollection.HEALTH_METRICS)
      .doc(endpointId)
      .collection('history')
      .doc();
    
    const historyData = {
      id: historyRef.id,
      timestamp: now,
      status,
      error,
      durationMs: refreshDurationMs,
      endpointId,
      nextRefreshAt,
      lastUpdated: now,
      metadata: {
        trigger: 'scheduled'
      }
    };
    
    batch.set(historyRef, historyData);
    
    // Update the latest status for quick lookups
    const latestRef = db
      .collection(FirestoreCollection.HEALTH_METRICS)
      .doc(endpointId)
      .collection('latest')
      .doc('status');
      
    const latestUpdate = {
      lastRefreshAttempt: now,
      lastRefreshStatus: status,
      nextRefreshAt,
      lastUpdated: now,
      error: status === RefreshStatus.FAILURE ? error : null,
      durationMs: refreshDurationMs,
      refreshStatus: this.calculateRefreshStatus(nextRefreshAt, config.ttl)
    };
    
    batch.set(latestRef, latestUpdate, { merge: true });
    
    // Generalized logic to update metadata for all endpoints
    const metaRef = db.doc(`${FirestoreCollection.HEALTH_METRICS}/${endpointId}`);
    const metaUpdate = {
      lastRefreshAttempt: now,
      lastRefreshStatus: status,
      lastUpdated: now,
      error: status === RefreshStatus.FAILURE ? error : null,
      durationMs: refreshDurationMs
    };
    batch.set(metaRef, metaUpdate, { merge: true });
    
    await batch.commit();
  }

  async recordSymbolRefresh(
    endpointId: string,
    symbol: string,
    status: RefreshStatus,
    durationMs: number,
    error?: string
  ): Promise<void> {
    const batch = db.batch();
    const now = new Date();
    
    // Update symbol metrics
    const symbolRef = db
      .collection(FirestoreCollection.HEALTH_METRICS)
      .doc(endpointId)
      .collection('symbols')
      .doc(symbol);

    const symbolData = (await symbolRef.get()).data() || {
      refreshCount: 0,
      successCount: 0,
      failureCount: 0,
      totalDurationMs: 0,
      firstSeen: now,
      lastSeen: now
    };

    const updates: Partial<SymbolRefreshMetrics> = {
      symbol,
      endpointId,
      lastUpdated: now,
      lastStatus: status,
      refreshCount: (symbolData.refreshCount || 0) + 1,
      successCount: symbolData.successCount || 0,
      failureCount: symbolData.failureCount || 0,
      totalDurationMs: (symbolData.totalDurationMs || 0) + (durationMs || 0),
      lastSeen: now,
      firstSeen: symbolData.firstSeen || now
    };

    if (status === RefreshStatus.SUCCESS) {
      updates.successCount = (updates.successCount || 0) + 1;
    } else {
      updates.failureCount = (updates.failureCount || 0) + 1;
      updates.lastError = error;
    }

    // Calculate average duration safely
    const totalDuration = updates.totalDurationMs || 0;
    const refreshCount = updates.refreshCount || 1;
    updates.avgDurationMs = Math.round(totalDuration / refreshCount);

    batch.set(symbolRef, updates, { merge: true });

    // Log the request
    const logRef = db.collection(FirestoreCollection.REQUEST_LOGS).doc();
    
    batch.set(logRef, {
      id: logRef.id,
      timestamp: now,
      endpointId,
      symbol,
      status,
      durationMs,
      error,
      metadata: {}
    });

    // Update the symbol status
    const statusRef = db
      .collection(FirestoreCollection.ENDPOINT_SYMBOLS)
      .doc(endpointId)
      .collection('status')
      .doc(symbol);

    const statusUpdate: Partial<SymbolStatus> = {
      symbol,
      endpointId,
      status: error ? 'error' : 'success',
      lastUpdated: now,
      updatedAt: now,
      lastError: error || undefined,
      refreshCount: updates.refreshCount,
      successRate: updates.successCount ? (updates.successCount / updates.refreshCount!) * 100 : 0,
      avgDurationMs: updates.avgDurationMs,
      lastDurationMs: durationMs
    };

    batch.set(statusRef, statusUpdate, { merge: true });
    await batch.commit();
  }

  async getSymbolsByStatus(
    endpointId: string,
    status: 'success' | 'error' | 'stale',
    limit = 100
  ): Promise<SymbolStatus[]> {
    const snapshot = await db
      .collection(FirestoreCollection.ENDPOINT_SYMBOLS)
      .doc(endpointId)
      .collection('status')
      .where('status', '==', status)
      .orderBy('lastUpdated', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map(doc => ({
      ...doc.data(),
      symbol: doc.id,
      endpointId
    } as SymbolStatus));
  }

  /**
   * Gets health metrics for all endpoints with aggregated data
   */
  async getHealthSummary(): Promise<HealthSummary> {
    const endpoints = Object.values(AlphaVantageEndpoint);
    const now = new Date();
    
    const metrics = await Promise.all(
      endpoints.map(endpoint => this.getEndpointHealth(endpoint))
    );

    // Calculate summary statistics
    const summary: HealthSummary = {
      totalEndpoints: metrics.length,
      healthyEndpoints: metrics.filter(m => m.healthStatus === 'healthy').length,
      errorEndpoints: metrics.filter(m => m.healthStatus === 'error').length,
      degradedEndpoints: metrics.filter(m => m.healthStatus === 'degraded').length,
      totalSymbols: metrics.reduce((sum, m) => sum + (m.symbols?.total || 0), 0),
      errorSymbols: metrics.reduce((sum, m) => sum + (m.symbols?.error || 0), 0),
      staleSymbols: metrics.reduce((sum, m) => sum + (m.symbols?.stale || 0), 0),
      lastUpdated: now,
      recentErrors: []
    };

    // Get recent errors
    const errorLogs = await db
      .collection(FirestoreCollection.REQUEST_LOGS)
      .where('status', '==', 'failure')
      .orderBy('timestamp', 'desc')
      .limit(10)
      .get();

    summary.recentErrors = errorLogs.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        timestamp: data.timestamp,
        endpointId: data.endpointId,
        symbol: data.symbol,
        error: data.error || 'Unknown error'
      };
    });

    return summary;
  }

  /**
   * Gets paginated request logs with filtering
   */
  async getRequestLogs(
    filter: HealthMetricsFilter = {}
  ): Promise<HealthMetricsResponse<RefreshRequestLog>> {
    let query: FirebaseFirestore.Query = db.collection(FirestoreCollection.REQUEST_LOGS);
    
    // Apply filters
    if (filter.endpointIds?.length) {
      query = query.where('endpointId', 'in', filter.endpointIds);
    }
    
    if (filter.symbols?.length) {
      query = query.where('symbol', 'in', filter.symbols);
    }
    
    if (filter.timeRange?.from) {
      query = query.where('timestamp', '>=', filter.timeRange.from);
    }
    
    if (filter.timeRange?.to) {
      query = query.where('timestamp', '<=', filter.timeRange.to);
    }
    
    // Apply sorting
    const sortField = filter.sortBy || 'timestamp';
    const sortOrder = filter.sortOrder === 'asc' ? 'asc' : 'desc';
    query = query.orderBy(sortField, sortOrder);
    
    // Apply pagination
    const limit = Math.min(filter.limit || this.DEFAULT_LIMIT, this.MAX_LIMIT);
    const offset = filter.offset || 0;
    
    // Get total count for pagination
    const countSnapshot = await query.count().get();
    const total = countSnapshot.data().count;
    
    // Apply pagination
    query = query.limit(limit).offset(offset);
    
    const snapshot = await query.get();
    const data = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as RefreshRequestLog[];
    
    return {
      data,
      total,
      limit,
      offset,
      hasMore: offset + data.length < total
    };
  }

  /**
   * Gets detailed metrics for a specific symbol
   * @param symbol The symbol to get metrics for
   * @returns Symbol metrics or null if not found
   */
  async getSymbolMetrics(symbol: string): Promise<SymbolRefreshMetrics | null> {
    // Get all endpoints where this symbol exists
    const snapshot = await db
      .collectionGroup('symbols')
      .where('symbol', '==', symbol)
      .limit(1)
      .get();
      
    if (snapshot.empty) return null;
    
    const doc = snapshot.docs[0];
    const data = doc.data();
    
    return {
      symbol,
      endpointId: data.endpointId,
      lastUpdated: data.lastUpdated || new Date(),
      lastStatus: data.lastStatus || 'unknown',
      lastError: data.lastError,
      refreshCount: data.refreshCount || 0,
      successCount: data.successCount || 0,
      failureCount: data.failureCount || 0,
      totalDurationMs: data.totalDurationMs || 0,
      avgDurationMs: data.avgDurationMs || 0,
      firstSeen: data.firstSeen || new Date(),
      lastSeen: data.lastSeen || new Date()
    } as SymbolRefreshMetrics;
  }

  /**
   * Gets the current status of a symbol across all endpoints
   */
  async getSymbolStatus(symbol: string): Promise<SymbolStatus | null> {
    const snapshot = await db
      .collectionGroup('status')
      .where('symbol', '==', symbol)
      .limit(1)
      .get();
      
    if (snapshot.empty) return null;
    
    const doc = snapshot.docs[0];
    return {
      symbol,
      endpointId: doc.data().endpointId,
      ...doc.data(),
      // Ensure all required fields have default values
      status: doc.data().status || 'unknown',
      lastUpdated: doc.data().lastUpdated || new Date(),
      updatedAt: doc.data().updatedAt || new Date(),
      refreshCount: doc.data().refreshCount || 0,
      successRate: doc.data().successRate || 0,
      avgDurationMs: doc.data().avgDurationMs || 0,
      lastDurationMs: doc.data().lastDurationMs
    } as SymbolStatus;
  }

  /**
   * Purge old endpoint history documents older than the provided cutoff date.
   * Deletes in batches (<=500 writes per batch) and returns the number of
   * deleted documents. A maxDelete cap can be provided to bound execution time.
   *
   * # Reason: Keep the append-only history lightweight and cost-efficient
   * without impacting the latest/status snapshot.
   */
  async purgeOldHistory(cutoff: Date, maxDelete: number = 2000): Promise<{ deletedCount: number }> {
    let deletedCount = 0;

    while (deletedCount < maxDelete) {
      const remaining = maxDelete - deletedCount;
      const pageSize = Math.min(remaining, 500); // Firestore batch limit

      const snapshot = await db
        .collectionGroup('history')
        .where('timestamp', '<', cutoff)
        .orderBy('timestamp', 'asc')
        .limit(pageSize)
        .get();

      if (snapshot.empty) break;

      const batch = db.batch();
      snapshot.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();

      deletedCount += snapshot.size;

      // If we fetched less than requested, no more matching docs
      if (snapshot.size < pageSize) break;
    }

    return { deletedCount };
  }
}

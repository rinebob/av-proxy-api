import { db } from '../../firebase-admin-init';
import { 
  AlphaVantageEndpoint, 
  AV_ENDPOINT_CONFIGS, 
  AV_TIME_SERIES_ENDPOINT_CONFIGS,
  AV_IMPLEMENTED_ENDPOINTS
} from '@shared/alpha-vantage';
import { FirestoreCollection, RefreshStatus, RefreshTrigger } from '@shared/firestore';
import { 
  EndpointHealthMetrics,
  RefreshRequestLog, 
  SymbolRefreshMetrics,
  SymbolStatus,
  HealthSummary,
  HealthMetricsFilter,
  HealthMetricsResponse,
  RefreshRecency,
  HealthStatus,
  SymbolHealthState,
} from '@shared/health-metrics';

export class HealthMetricsService {
  private readonly DEFAULT_LIMIT = 100;
  private readonly MAX_LIMIT = 1000;

  async getEndpointHealth(endpointId: AlphaVantageEndpoint): Promise<EndpointHealthMetrics> {
    // Get the latest refresh history for this endpoint
    const historyRef = db
      .collection(FirestoreCollection.HEALTH_METRICS)
      .doc(endpointId)
      .collection(FirestoreCollection.HEALTH_HISTORY)
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
      healthStatus: HealthStatus.Healthy,
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
    
    // Aggregate per-symbol status for this endpoint
    try {
      const symbolsSnap = await db
        .collection(FirestoreCollection.ENDPOINT_SYMBOLS)
        .doc(endpointId)
        .collection(FirestoreCollection.STATUS)
        .get();

      let total = 0;
      let fresh = 0;
      let stale = 0;
      let errorCount = 0;
      let lastUpdatedMax: Date | undefined;

      for (const doc of symbolsSnap.docs) {
        total++;
        const data = doc.data() as any;
        const status = (data?.status ?? SymbolHealthState.Unknown) as SymbolHealthState;
        if (status === SymbolHealthState.Success) fresh++;
        else if (status === SymbolHealthState.Stale) stale++;
        else if (status === SymbolHealthState.Error) errorCount++;

        const lu: any = data?.lastUpdated;
        let luDate: Date | undefined;
        if (lu) {
          if (typeof lu.toDate === 'function') luDate = lu.toDate();
          else if (typeof lu === 'number') luDate = new Date(lu);
          else if (typeof lu === 'string') luDate = new Date(Number(lu));
        }
        if (luDate && (!lastUpdatedMax || luDate > lastUpdatedMax)) lastUpdatedMax = luDate;
      }

      healthMetrics.symbols = {
        total,
        fresh,
        stale,
        error: errorCount,
        lastUpdated: lastUpdatedMax || healthMetrics.lastUpdated || new Date(),
      };
    } catch (e) {
      // Best-effort aggregation; keep defaults on failure
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

  private calculateRefreshStatus(nextRefreshAt?: Date, ttlSeconds?: number): RefreshRecency {
    if (!nextRefreshAt) return RefreshRecency.Never;
    const now = new Date();
    return now < nextRefreshAt ? RefreshRecency.Fresh : RefreshRecency.Stale;
  }

  /**
   * Checks the health of an endpoint without creating history entries
   * @param endpointId The endpoint to check
   * @returns The current health metrics for the endpoint
   */
  async checkEndpointHealth(endpointId: AlphaVantageEndpoint): Promise<EndpointHealthMetrics> {
    const metrics = await this.getEndpointHealth(endpointId);
    const now = new Date();
    
    // Update only the latest status without creating history
    const latestRef = db
      .collection(FirestoreCollection.HEALTH_METRICS)
      .doc(endpointId)
      .collection(FirestoreCollection.LATEST)
      .doc('status');
    
    await latestRef.set({
      lastHealthCheck: now,
      refreshStatus: metrics.refreshStatus,
      lastUpdated: now
    }, { merge: true });
    
    return metrics;
  }

  /**
   * Records an actual refresh attempt (creates history entries)
   * @param endpointId The endpoint that was refreshed
   * @param status Whether the refresh was successful
   * @param error Optional error message if the refresh failed
   * @param refreshDurationMs How long the refresh took in milliseconds
   * @param trigger The trigger type for the refresh
   */
  async recordRefreshAttempt(
    endpointId: AlphaVantageEndpoint,
    status: RefreshStatus,
    error?: string,
    refreshDurationMs?: number,
    trigger: RefreshTrigger = RefreshTrigger.SCHEDULER
  ): Promise<void> {
    const batch = db.batch();
    const now = new Date();
    
    // Calculate next refresh time based on trigger type
    let nextRefreshAt: Date | null = new Date(now);
    
    // Set next refresh time based on trigger type
    switch (trigger) {
      case RefreshTrigger.SCHEDULER:
        // For scheduled refreshes, use a default interval (e.g., 1 hour)
        nextRefreshAt.setHours(nextRefreshAt.getHours() + 1);
        break;
        
      case RefreshTrigger.MANUAL:
        // For manual refreshes, don't set a next refresh time
        nextRefreshAt = null;
        break;
        
      // Other trigger types will use the default refresh time (now + 1 hour)
      default:
        nextRefreshAt.setHours(nextRefreshAt.getHours() + 1);
        break;
    }
    
    // Create a new history entry
    const historyRef = db
      .collection(FirestoreCollection.HEALTH_METRICS)
      .doc(endpointId)
      .collection(FirestoreCollection.HEALTH_HISTORY)
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
        trigger
      }
    };
    
    batch.set(historyRef, historyData);
    
    // Update the latest status for quick lookups
    const latestRef = db
      .collection(FirestoreCollection.HEALTH_METRICS)
      .doc(endpointId)
      .collection(FirestoreCollection.LATEST)
      .doc('status');
      
    const latestUpdate = {
      lastRefreshAttempt: now,
      lastRefreshStatus: status,
      nextRefreshAt,
      lastUpdated: now,
      error: status === RefreshStatus.FAILURE ? error : null,
      durationMs: refreshDurationMs,
      refreshStatus: status === RefreshStatus.SUCCESS ? RefreshRecency.Fresh : RefreshRecency.Stale
    };
    
    batch.set(latestRef, latestUpdate, { merge: true });
    
    // Update the top-level metadata
    const metaRef = db.doc(`${FirestoreCollection.HEALTH_METRICS}/${endpointId}`);
    const metaUpdate = {
      lastRefreshAttempt: now,
      lastRefreshStatus: status,
      lastUpdated: now,
      error: status === RefreshStatus.FAILURE ? error : null,
      durationMs: refreshDurationMs,
      nextRefreshAt
    };
    batch.set(metaRef, metaUpdate, { merge: true });
    
    await batch.commit();
  }

  async recordSymbolRefresh(
    endpointId: string,
    symbol: string,
    status: RefreshStatus,
    durationMs: number,
    error?: string,
    metadata?: Record<string, any>
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
      metadata: metadata || {}
    });

    // Update the symbol status
    const statusRef = db
      .collection(FirestoreCollection.ENDPOINT_SYMBOLS)
      .doc(endpointId)
      .collection(FirestoreCollection.STATUS)
      .doc(symbol);

    const statusUpdate: Partial<SymbolStatus> = {
      symbol,
      endpointId,
      status: error ? SymbolHealthState.Error : SymbolHealthState.Success,
      lastUpdated: now,
      updatedAt: now,
      lastError: error || undefined,
      refreshCount: updates.refreshCount,
      successRate: updates.successCount ? (updates.successCount / updates.refreshCount!) * 100 : 0,
      avgDurationMs: updates.avgDurationMs,
      lastDurationMs: durationMs
    };

    batch.set(statusRef, statusUpdate, { merge: true });

    // Update endpoint-level metadata under endpoint-symbols/{endpoint}
    const endpointMetaRef = db
      .collection(FirestoreCollection.ENDPOINT_SYMBOLS)
      .doc(endpointId);
    const endpointMetaUpdate = {
      endpointId,
      lastUpdated: now,
      lastStatus: status,
      lastSymbol: symbol,
      lastError: error || null,
      lastDurationMs: durationMs,
    };
    batch.set(endpointMetaRef, endpointMetaUpdate, { merge: true });

    await batch.commit();
  }

  /**
   * Returns a list of symbols for an endpoint filtered by SymbolHealthState.
   */
  async getSymbolsByStatus(
    endpointId: string,
    status: SymbolHealthState,
    limit = 100
  ): Promise<SymbolStatus[]> {
    const snapshot = await db
      .collection(FirestoreCollection.ENDPOINT_SYMBOLS)
      .doc(endpointId)
      .collection(FirestoreCollection.STATUS)
      .where('status', '==', status)
      .orderBy('lastUpdated', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map(doc => ({
      ...(doc.data() as SymbolStatus),
      symbol: doc.id,
      endpointId,
    }));
  }

  /**
   * Gets health metrics for all endpoints with aggregated data
   */
  async getHealthSummary(): Promise<HealthSummary> {
    // Use only actively implemented endpoints to reflect real system state
    const endpoints = Array.from(AV_IMPLEMENTED_ENDPOINTS) as AlphaVantageEndpoint[];
    const now = new Date();
    
    const metrics = await Promise.all(
      endpoints.map(endpoint => this.getEndpointHealth(endpoint))
    );

    // Calculate summary statistics
    const summary: HealthSummary = {
      totalEndpoints: metrics.length,
      healthyEndpoints: metrics.filter(m => m.healthStatus === HealthStatus.Healthy).length,
      errorEndpoints: metrics.filter(m => m.healthStatus === HealthStatus.Error).length,
      degradedEndpoints: metrics.filter(m => m.healthStatus === HealthStatus.Degraded).length,
      totalSymbols: metrics.reduce((sum, m) => sum + (m.symbols?.total || 0), 0),
      errorSymbols: metrics.reduce((sum, m) => sum + (m.symbols?.error || 0), 0),
      staleSymbols: metrics.reduce((sum, m) => sum + (m.symbols?.stale || 0), 0),
      lastUpdated: now,
      recentErrors: []
    };

    // Get recent errors (requires composite index on status ASC, timestamp DESC)
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
      .collectionGroup(FirestoreCollection.STATUS)
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
      status: doc.data().status || SymbolHealthState.Unknown,
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
        .collectionGroup(FirestoreCollection.HEALTH_HISTORY)
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

  /**
   * Purge request log documents older than the provided cutoff date.
   * Deletes in batches (<=500 writes per batch) and returns the number of
   * deleted documents. A maxDelete cap can be provided to bound execution time.
   *
   * # Reason: Keep request logs bounded (e.g., last 30 days) to control costs
   * and ensure dashboard queries remain efficient.
   */
  async purgeOldRequestLogs(cutoff: Date, maxDelete: number = 5000): Promise<{ deletedCount: number }> {
    let deletedCount = 0;

    while (deletedCount < maxDelete) {
      const remaining = maxDelete - deletedCount;
      const pageSize = Math.min(remaining, 500);

      let snapshot: FirebaseFirestore.QuerySnapshot;
      snapshot = await db
        .collection(FirestoreCollection.REQUEST_LOGS)
        .where('timestamp', '<', cutoff)
        .orderBy('timestamp', 'asc')
        .limit(pageSize)
        .get();

      if (snapshot.empty) break;

      const batch = db.batch();
      snapshot.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();

      deletedCount += snapshot.size;

      if (snapshot.size < pageSize) break;
    }

    return { deletedCount };
  }
}

import { db } from '../../firebase-admin-init';
import { AlphaVantageEndpoint } from '@shared/alpha-vantage';
import { FirestoreCollection } from '@shared/firestore';
import { 
  AV_ENDPOINT_CONFIGS, 
  AV_TIME_SERIES_ENDPOINT_CONFIGS,
} from '@shared/alpha-vantage/av-endpoint-configs';

export interface EndpointHealthMetrics {
  endpointId: string;
  endpointName: string;
  ttlSeconds: number;
  lastUpdated?: Date;
  nextRefreshAt?: Date;
  refreshStatus: 'fresh' | 'stale' | 'never';
  lastRefreshAttempt?: Date;
  lastRefreshStatus?: 'success' | 'failure';
  error?: string;
}

export class HealthMetricsService {
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
    
    return {
      endpointId,
      endpointName: config.name,
      ttlSeconds: config.ttl || 0,
      lastUpdated: latest?.lastUpdated?.toDate(),
      nextRefreshAt: latest?.nextRefreshAt?.toDate(),
      refreshStatus: this.calculateRefreshStatus(latest?.nextRefreshAt?.toDate(), config.ttl),
      lastRefreshAttempt: latest?.timestamp?.toDate(),
      lastRefreshStatus: latest?.status,
      error: latest?.error
    };
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
  
  private calculateRefreshStatus(nextRefreshAt?: Date, ttlSeconds?: number): 'fresh' | 'stale' | 'never' {
    if (!nextRefreshAt) return 'never';
    const now = new Date();
    return now < nextRefreshAt ? 'fresh' : 'stale';
  }

  /**
   * Records a refresh attempt for an endpoint
   * @param endpointId The endpoint that was refreshed
   * @param status Whether the refresh was successful
   * @param error Optional error message if the refresh failed
   * @param refreshDurationMs How long the refresh took in milliseconds
   */
  async recordRefreshAttempt(
    endpointId: AlphaVantageEndpoint,
    status: 'success' | 'failure',
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
    
    batch.set(historyRef, {
      timestamp: now,
      status,
      error,
      durationMs: refreshDurationMs,
      endpointId,
      nextRefreshAt,
      lastUpdated: now
    });
    
    // Update the latest status for quick lookups
    const latestRef = db
      .collection(FirestoreCollection.HEALTH_METRICS)
      .doc(endpointId)
      .collection('latest')
      .doc('status');
      
    batch.set(latestRef, {
      lastRefreshAttempt: now,
      lastRefreshStatus: status,
      nextRefreshAt,
      lastUpdated: now,
      error: status === 'failure' ? error : null,
      durationMs: refreshDurationMs
    }, { merge: true });
    
    await batch.commit();
  }
}

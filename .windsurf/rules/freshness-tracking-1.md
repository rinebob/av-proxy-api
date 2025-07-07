---
trigger: manual
---

Data Freshness Tracking System - Implementation Document
========================================================

Table of Contents
-----------------

-   [1\. Introduction](https://www.google.com/search?q=%231-introduction "null")

-   [2\. System Architecture](https://www.google.com/search?q=%232-system-architecture "null")

-   [3\. Data Model](https://www.google.com/search?q=%233-data-model "null")

    -   [3.1 Company-Specific Data](https://www.google.com/search?q=%2331-company-specific-data "null")

    -   [3.2 Market-Wide Data](https://www.google.com/search?q=%2332-market-wide-data "null")

    -   [3.3 Refresh History](https://www.google.com/search?q=%2333-refresh-history "null")

-   [4\. Core Implementation](https://www.google.com/search?q=%234-core-implementation "null")

    -   [4.1 Path Generation](https://www.google.com/search?q=%2341-path-generation "null")

    -   [4.2 Logging Refresh Events](https://www.google.com/search?q=%2342-logging-refresh-events "null")

    -   [4.3 Helper Functions](https://www.google.com/search?q=%2343-helper-functions "null")

-   [5\. Usage Examples](https://www.google.com/search?q=%235-usage-examples "null")

    -   [5.1 Storing Company-Specific Data](https://www.google.com/search?q=%2351-storing-company-specific-data "null")

    -   [5.2 Storing Market-Wide Data](https://www.google.com/search?q=%2352-storing-market-wide-data "null")

-   [6\. Security Rules](https://www.google.com/search?q=%236-security-rules "null")

-   [7\. Querying Data](https://www.google.com/search?q=%237-querying-data "null")

    -   [7.1 Get Latest Data](https://www.google.com/search?q=%2371-get-latest-data "null")

    -   [7.2 Get Refresh History](https://www.google.com/search?q=%2372-get-refresh-history "null")

-   [8\. Dashboard Integration](https://www.google.com/search?q=%238-dashboard-integration "null")

    -   [8.1 Data Freshness Dashboard](https://www.google.com/search?q=%2381-data-freshness-dashboard "null")

    -   [8.2 Error Monitoring](https://www.google.com/search?q=%2382-error-monitoring "null")

-   [9\. Error Handling](https://www.google.com/search?q=%239-error-handling "null")

    -   [9.1 Retry Mechanism](https://www.google.com/search?q=%2391-retry-mechanism "null")

-   [10\. Performance Considerations](https://www.google.com/search?q=%2310-performance-considerations "null")

-   [11\. Monitoring and Alerting](https://www.google.com/search?q=%2311-monitoring-and-alerting "null")

    -   [11.1 Key Metrics to Monitor](https://www.google.com/search?q=%23111-key-metrics-to-monitor "null")

    -   [11.2 Alert Conditions](https://www.google.com/search?q=%23112-alert-conditions "null")

-   [12\. Next Steps](https://www.google.com/search?q=%2312-next-steps "null")

-   [13\. Future Enhancements](https://www.google.com/search?q=%2313-future-enhancements "null")

-   [14\. Success Metrics](https://www.google.com/search?q=%2314-success-metrics "null")

-   [15\. Dependencies](https://www.google.com/search?q=%2315-dependencies "null")

-   [16\. Risks and Mitigation](https://www.google.com/search?q=%2316-risks-and-mitigation "null")

1\. Introduction
----------------

This document details the implementation of a refresh history tracking system for financial data endpoints. The system is designed to work with both company-specific and market-wide data, storing them in separate collections while maintaining a consistent structure for metadata and refresh history.

2\. System Architecture
-----------------------

### 2.1 Components

-   **Refresh Event Logger**

    -   Captures refresh events with detailed metadata

    -   Handles both successful and failed refresh attempts

    -   Records performance metrics

-   **Aggregation Service**

    -   Periodically computes aggregated statistics

    -   Maintains summary views for dashboard performance

-   **Data Access Layer**

    -   Secure access to refresh history

    -   Efficient querying capabilities

-   **Dashboard UI (Future)**

    -   Visual representation of refresh metrics

    -   Alerting and monitoring interface

3\. Data Model
--------------

### 3.1 Company-Specific Data

**Path:**  `company-data/{symbol}/{endpoint}/{vendorPrefix}-{endpointName}`

**Document Structure:**

```
{
  // Core data
  data: any,                 // The actual API response data
  metadata: {                // Metadata about this data
    lastUpdated: Timestamp,
    nextRefreshAt: Timestamp,
    ttlSeconds: number,
    vendor: string,          // 'av' or 'bz'
    endpoint: string,        // Original endpoint name
    symbol: string           // Redundant but useful for queries
  },
  lastRefreshEvent: {        // Summary of last refresh
    timestamp: Timestamp,
    status: 'success' | 'failure',
    durationMs: number,
    error: string | null
  }
}

```

### 3.2 Market-Wide Data

**Path:**  `market-data/{vendorPrefix}-{endpointName}`

**Document Structure:**

```
{
  // Core data
  data: any,                 // The actual API response data
  metadata: {                // Metadata about this data
    lastUpdated: Timestamp,
    nextRefreshAt: Timestamp,
    ttlSeconds: number,
    vendor: string,          // 'av' or 'bz'
    endpoint: string         // Original endpoint name
  },
  lastRefreshEvent: {        // Summary of last refresh
    timestamp: Timestamp,
    status: 'success' | 'failure',
    durationMs: number,
    error: string | null
  }
}

```

### 3.3 Refresh History

**Path (Company):**  `company-data/{symbol}/{endpoint}/{vendorPrefix}-{endpointName}/refresh-history/{YYYY-MM-DDTHH:MM:SSZ}`

**Path (Market):**  `market-data/{vendorPrefix}-{endpointName}/refresh-history/{YYYY-MM-DDTHH:MM:SSZ}`

**Document Structure:**

```
{
  timestamp: Timestamp,      // Same as document ID
  status: 'success' | 'failure',
  durationMs: number,        // How long the refresh took
  httpStatus: number | null,
  responseSize: number | null,
  error: string | null,      // Error details if failed
  triggeredBy: 'scheduler' | 'manual' | 'retry',
  instanceId: string,        // Which function instance processed this
  region: string,            // GCP region
  endpoint: string,          // For easier querying
  vendor: string,            // 'av' or 'bz'
  symbol: string | null,     // Null for market-wide data
  endpointParams: object     // Any parameters used for the request
}

```

4\. Core Implementation
-----------------------

### 4.1 Path Generation

```
// functions/src/data-maintainer/paths.ts
import * as admin from 'firebase-admin';

/**
 * Gets the document path for a data entry
 * @param vendor The vendor ('alpha-vantage' or 'benzinga')
 * @param endpoint The endpoint name
 * @param symbol Optional symbol for company-specific data
 * @returns Full document path
 */
export function getDocumentPath(
  vendor: 'alpha-vantage' | 'benzinga',
  endpoint: string,
  symbol?: string
): string {
  const vendorPrefix = vendor === 'alpha-vantage' ? 'av' : 'bz';
  const docId = `${vendorPrefix}-${endpoint}`;

  return symbol
    ? `company-data/${symbol}/${endpoint}/${docId}`
    : `market-data/${docId}`;
}

/**
 * Gets the refresh history collection path for a data entry
 * @param vendor The vendor ('alpha-vantage' or 'benzinga')
 * @param endpoint The endpoint name
 * @param symbol Optional symbol for company-specific data
 * @returns Full collection path for refresh history
 */
export function getRefreshHistoryPath(
  vendor: 'alpha-vantage' | 'benzinga',
  endpoint: string,
  symbol?: string
): string {
  const vendorPrefix = vendor === 'alpha-vantage' ? 'av' : 'bz';
  const docId = `${vendorPrefix}-${endpoint}`;

  return symbol
    ? `company-data/${symbol}/${endpoint}/${docId}/refresh-history`
    : `market-data/${docId}/refresh-history`;
}

```

### 4.2 Logging Refresh Events

```
// functions/src/data-maintainer/refresh-history.ts
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import { getDocumentPath, getRefreshHistoryPath } from './paths';

type RefreshStatus = 'success' | 'failure';
type TriggerSource = 'scheduler' | 'manual' | 'retry';

interface RefreshEvent {
  status: RefreshStatus;
  durationMs: number;
  error?: string;
  httpStatus?: number;
  responseSize?: number;
  triggeredBy: TriggerSource;
  endpointParams?: Record<string, any>;
}

interface TtlConfig {
  [endpoint: string]: number;
}

// Default TTLs in seconds
const DEFAULT_TTLS: TtlConfig = {
  'GLOBAL_QUOTE': 30,          // 30 seconds
  'TIME_SERIES_DAILY': 3600,   // 1 hour
  'EARNINGS': 86400,           // 1 day
  'SECTOR': 300,               // 5 minutes
  // Add more endpoints as needed
};

/**
 * Gets the TTL for an endpoint
 */
function getTtlForEndpoint(endpoint: string): number {
  return DEFAULT_TTLS[endpoint] || 3600; // Default to 1 hour
}

/**
 * Logs a refresh event to Firestore
 */
export async function logRefreshEvent(
  vendor: 'alpha-vantage' | 'benzinga',
  endpoint: string,
  event: RefreshEvent,
  symbol?: string
): Promise<void> {
  const db = admin.firestore();
  const batch = db.batch();
  const now = admin.firestore.Timestamp.now();

  // Generate document and collection paths
  const docPath = getDocumentPath(vendor, endpoint, symbol);
  const historyPath = getRefreshHistoryPath(vendor, endpoint, symbol);
  const vendorPrefix = vendor === 'alpha-vantage' ? 'av' : 'bz';
  const docId = `${vendorPrefix}-${endpoint}`;

  // Create a timestamp-based ID for the history document
  const refreshEventId = new Date().toISOString().replace(/[:.]/g, '-');
  const historyRef = db.collection(historyPath).doc(refreshEventId);

  // Prepare the refresh event data
  const refreshEvent = {
    ...event,
    timestamp: now,
    instanceId: process.env.FUNCTION_INSTANCE || 'unknown',
    region: process.env.FUNCTION_REGION || 'unknown',
    endpoint,
    vendor: vendorPrefix,
    symbol: symbol || null
  };

  // Prepare the update for the main document
  const updateData: any = {
    'metadata': {
      lastUpdated: now,
      vendor: vendorPrefix,
      endpoint,
      ...(symbol && { symbol }), // Only include symbol for company data
      ttlSeconds: getTtlForEndpoint(endpoint)
    },
    'lastRefreshEvent': {
      timestamp: now,
      status: event.status,
      durationMs: event.durationMs,
      error: event.error || null
    }
  };

  // Set next refresh time for successful updates
  if (event.status === 'success') {
    updateData.metadata.nextRefreshAt = new admin.firestore.Timestamp(
      Math.floor(Date.now() / 1000) + getTtlForEndpoint(endpoint),
      0
    );
    updateData.metadata.lastError = null;
  } else {
    updateData.metadata.lastError = event.error;
  }

  // Add operations to batch
  batch.set(historyRef, refreshEvent);
  batch.set(db.doc(docPath), updateData, { merge: true });

  try {
    await batch.commit();
    functions.logger.info(`Logged refresh event for ${vendor} ${endpoint}`, {
      symbol,
      status: event.status,
      durationMs: event.durationMs
    });
  } catch (error) {
    functions.logger.error('Failed to log refresh event', {
      error: error.message,
      docPath,
      historyPath
    });
    // Consider throwing or handling the error as needed
  }
}

```

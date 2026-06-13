---
trigger: manual
---


### 4.3 Helper Functions

```
// functions/src/data-maintainer/helpers.ts
import * as admin from 'firebase-admin';
import { getDocumentPath } from './paths';

/**
 * Fetches data from Firestore, handling both company and market data
 */
export async function fetchData<T>(
  vendor: 'alpha-vantage' | 'benzinga',
  endpoint: string,
  symbol?: string
): Promise<{ data: T | null; lastUpdated: Date | null }> {
  const db = admin.firestore();
  const docRef = db.doc(getDocumentPath(vendor, endpoint, symbol));

  try {
    const doc = await docRef.get();
    if (!doc.exists) {
      return { data: null, lastUpdated: null };
    }

    const data = doc.data();
    return {
      data: data?.data as T,
      lastUpdated: data?.metadata?.lastUpdated?.toDate() || null
    };
  } catch (error) {
    console.error(`Error fetching ${endpoint} for ${symbol || 'market'}`, error);
    throw error;
  }
}

/**
 * Checks if data needs to be refreshed
 */
export function needsRefresh(
  metadata: { nextRefreshAt?: admin.firestore.Timestamp },
  forceRefresh: boolean = false
): boolean {
  if (forceRefresh) return true;
  if (!metadata?.nextRefreshAt) return true;

  const now = admin.firestore.Timestamp.now();
  return now >= metadata.nextRefreshAt;
}

```

5\. Usage Examples
------------------

### 5.1 Storing Company-Specific Data

```
import { logRefreshEvent } from './data-maintainer/refresh-history';

// Example: Log successful refresh of AAPL earnings
await logRefreshEvent(
  'alpha-vantage',
  'EARNINGS',
  {
    status: 'success',
    durationMs: 450,
    httpStatus: 200,
    responseSize: 2048,
    triggeredBy: 'scheduler',
    endpointParams: { symbol: 'AAPL' }
  },
  'AAPL'  // Ticker symbol makes it company-specific
);

// Example: Log failed refresh of MSFT quote
await logRefreshEvent(
  'alpha-vantage',
  'GLOBAL_QUOTE',
  {
    status: 'failure',
    durationMs: 1200,
    error: 'API rate limit exceeded',
    httpStatus: 429,
    triggeredBy: 'scheduler',
    endpointParams: { symbol: 'MSFT' }
  },
  'MSFT'
);

```

### 5.2 Storing Market-Wide Data

```
import { logRefreshEvent } from './data-maintainer/refresh-history';

// Example: Log successful refresh of sector performance
await logRefreshEvent(
  'alpha-vantage',
  'SECTOR',
  {
    status: 'success',
    durationMs: 320,
    httpStatus: 200,
    responseSize: 1024,
    triggeredBy: 'scheduler'
  }
  // No ticker makes it market-wide
);

// Example: Log failed refresh of market status
await logRefreshEvent(
  'alpha-vantage',
  'MARKET_STATUS',
  {
    status: 'failure',
    durationMs: 5000,  // 5 seconds timeout
    error: 'Request timed out',
    triggeredBy: 'retry'
  }
);

```

6\. Security Rules
------------------

```
// firestore.rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Helper function to check if user is authenticated
    function isAuthenticated() {
      return request.auth != null;
    }

    // Company data
    match /company-data/{symbol} {
      allow read: if isAuthenticated();

      match /{endpoint}/{document=**} {
        allow read: if isAuthenticated();

        // Allow writes only to admin (via Admin SDK)
        allow write: if false;
      }
    }

    // Market data
    match /market-data/{document=**} {
      allow read: if isAuthenticated();

      // Allow writes only to admin (via Admin SDK)
      allow write: if false;
    }
  }
}

```

7\. Querying Data
-----------------

### 7.1 Get Latest Data

```
import * as admin from 'firebase-admin';

// Get latest AAPL earnings data
async function getAaplEarnings() {
  const db = admin.firestore();
  const doc = await db.doc('company-data/AAPL/EARNINGS/av-EARNINGS').get();

  if (!doc.exists) {
    return null;
  }

  return {
    data: doc.data()?.data,
    lastUpdated: doc.data()?.metadata?.lastUpdated?.toDate(),
    lastStatus: doc.data()?.lastRefreshEvent?.status
  };
}

// Get latest sector performance
async function getSectorPerformance() {
  const db = admin.firestore();
  const doc = await db.doc('market-data/av-SECTOR').get();

  if (!doc.exists) {
    return null;
  }

  return {
    data: doc.data()?.data,
    lastUpdated: doc.data()?.metadata?.lastUpdated?.toDate(),
    nextRefresh: doc.data()?.metadata?.nextRefreshAt?.toDate()
  };
}

```

### 7.2 Get Refresh History

```
import * as admin from 'firebase-admin';

// Get refresh history for AAPL earnings
async function getAaplEarningsHistory(limit: number = 50) {
  const db = admin.firestore();
  const snapshot = await db
    .collection('company-data/AAPL/EARNINGS/av-EARNINGS/refresh-history')
    .orderBy('timestamp', 'desc')
    .limit(limit)
    .get();

  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
    timestamp: doc.data().timestamp?.toDate()
  }));
}

// Get refresh history for sector performance
async function getSectorHistory(limit: number = 50) {
  const db = admin.firestore();
  const snapshot = await db
    .collection('market-data/av-SECTOR/refresh-history')
    .orderBy('timestamp', 'desc')
    .limit(limit)
    .get();

  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
    timestamp: doc.data().timestamp?.toDate()
  }));
}

```

8\. Dashboard Integration
-------------------------

### 8.1 Data Freshness Dashboard

```
// Example dashboard query to get refresh status for all endpoints
async function getRefreshStatus() {
  const db = admin.firestore();

  // Get all company data endpoints
  const companySnapshot = await db.collectionGroup('company-data').get();

  // Get all market data endpoints
  const marketSnapshot = await db.collection('market-data').get();

  // Process company data
  const companyStatus = companySnapshot.docs.map(doc => {
    const data = doc.data();
    return {
      type: 'company',
      symbol: data.metadata?.symbol,
      endpoint: data.metadata?.endpoint,
      vendor: data.metadata?.vendor,
      lastUpdated: data.metadata?.lastUpdated?.toDate(),
      status: data.lastRefreshEvent?.status,
      error: data.lastRefreshEvent?.error,
      nextRefresh: data.metadata?.nextRefreshAt?.toDate()
    };
  });

  // Process market data
  const marketStatus = marketSnapshot.docs.map(doc => {
    const data = doc.data();
    return {
      type: 'market',
      endpoint: data.metadata?.endpoint,
      vendor: data.metadata?.vendor,
      lastUpdated: data.metadata?.lastUpdated?.toDate(),
      status: data.lastRefreshEvent?.status,
      error: data.lastRefreshEvent?.error,
      nextRefresh: data.metadata?.nextRefreshAt?.toDate()
    };
  });

  return [...companyStatus, ...marketStatus];
}

```

### 8.2 Error Monitoring

```
// Example: Get recent errors across all endpoints
async function getRecentErrors(limit: number = 50) {
  const db = admin.firestore();
  const errors = [];

  // Get errors from company data
  const companyErrors = await db
    .collectionGroup('refresh-history')
    .where('status', '==', 'failure')
    .orderBy('timestamp', 'desc')
    .limit(limit)
    .get();

  errors.push(...companyErrors.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
    timestamp: doc.data().timestamp?.toDate(),
    type: 'company'
  })));

  return errors.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
}

```

9\. Error Handling
------------------

### 9.1 Retry Mechanism

```
// functions/src/data-maintainer/retry.ts
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import { logRefreshEvent } from './refresh-history';

const MAX_RETRIES = 3;
const RETRY_DELAY = 5 * 60 * 1000; // 5 minutes

export async function withRetry<T>(
  vendor: 'alpha-vantage' | 'benzinga',
  endpoint: string,
  symbol: string | undefined,
  fn: () => Promise<T>,
  attempt: number = 1
): Promise<T> {
  const startTime = Date.now(); // Define startTime here

  try {
    const result = await fn();
    const durationMs = Date.now() - startTime;

    // Log successful execution
    await logRefreshEvent(
      vendor,
      endpoint,
      {
        status: 'success',
        durationMs,
        triggeredBy: attempt > 1 ? 'retry' : 'scheduler'
      },
      symbol
    );

    return result;
  } catch (error: any) { // Explicitly type error as 'any' or 'unknown' and handle
    const durationMs = Date.now() - startTime;

    // Log the failure
    await logRefreshEvent(
      vendor,
      endpoint,
      {
        status: 'failure',
        durationMs,
        error: error.message,
        httpStatus: error.response?.status,
        triggeredBy: attempt > 1 ? 'retry' : 'scheduler'
      },
      symbol
    );

    // Retry logic
    if (attempt < MAX_RETRIES) {
      functions.logger.warn(`Retrying ${endpoint} (attempt ${attempt + 1})`, {
        error: error.message,
        symbol
      });

      // Schedule retry
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * attempt));
      return withRetry(vendor, endpoint, symbol, fn, attempt + 1);
    }

    // Max retries exceeded
    throw new Error(`Failed after ${MAX_RETRIES} attempts: ${error.message}`);
  }
}

```

10\. Performance Considerations
-------------------------------

-   **Indexing:** Ensure proper indexing for common queries:

    -   `refresh-history` collections should be indexed on `timestamp`

    -   Consider composite indexes for common filter combinations

-   **Data Retention:**

    -   Implement a Cloud Function to prune old refresh history

    -   Consider keeping only the most recent N events or events within a certain time window

-   **Batch Operations:**

    -   Use Firestore batch writes for multiple operations

    -   Consider batching refresh events if they occur in high volume

-   **Caching:**

    -   Cache frequently accessed data in memory when possible

    -   Use Firestore's local caching for offline support in the dashboard

-   **Monitoring:**

    -   Set up alerts for repeated failures

    -   Monitor Firestore read/write operations to stay within quotas

11\. Monitoring and Alerting
----------------------------

### 11.1 Key Metrics to Monitor

-   Refresh failure rate

-   Average refresh duration

-   Error rates by endpoint

-   Data freshness

### 11.2 Alert Conditions

-   Multiple consecutive failures

-   Extended periods without refresh

-   Performance degradation

12\. Next Steps
---------------

-   Implement the core logging functionality

-   Set up the aggregation service

-   Deploy updated security rules

-   Begin dashboard development

13\. Future Enhancements
------------------------

-   **Advanced Analytics**

    -   Predictive freshness

    -   Anomaly detection

    -   Capacity planning

-   **Integration**

    -   Alerting system

    -   Incident management

    -   SLA tracking

-   **Optimization**

    -   Automated TTL adjustment

    -   Performance tuning

    -   Cost optimization

14\. Success Metrics
--------------------

-   **System Health**

    -   99.9% successful refresh rate

    -   <1% error rate

    -   <5s average refresh time

-   **Operational**

    -   <5 minutes to identify issues

    -   <15 minutes to resolve common problems

-   **Business Impact**

    -   Improved data reliability

    -   Reduced time to detect issues

    -   Better resource utilization

15\. Dependencies
-----------------

-   **Internal**

    -   Existing refresh dispatcher

    -   Authentication system

    -   Monitoring infrastructure

-   **External**

    -   Firebase/Firestore

    -   Cloud Functions

    -   Cloud Scheduler

16\. Risks and Mitigation
-------------------------

|

**Risk**

 |

**Impact**

 |

**Probability**

 |

**Mitigation**

 |
|

High volume of events

 |

High

 |

Medium

 |

Implement batching and rate limiting

 |
|

Performance impact

 |

High

 |

Low

 |

Monitor and optimize queries

 |
|

Data retention costs

 |

Medium

 |

High

 |

Implement TTL policies

 |
|

Schema evolution

 |

Medium

 |

High

 |

Design for backwar
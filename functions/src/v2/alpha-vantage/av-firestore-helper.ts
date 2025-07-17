import { db } from '../../firebase-admin-init';
import { FirestoreCollection } from '../../common/firestore-collections';
import { FieldValue } from 'firebase-admin/firestore';
import { AlphaVantageEndpoint } from '../../common/common-av';

export interface StoredAvData {
  data: any;
  metadata: {
    symbol: string;
    endpoint: AlphaVantageEndpoint;
    lastUpdated: FirebaseFirestore.FieldValue;
    nextRefreshAt: FirebaseFirestore.Timestamp;
    ttlSeconds: number;
  };
}

export interface SymbolMetadata {
  symbol: string;
  endpoints: AlphaVantageEndpoint[]; // List of endpoints that have data for this symbol
  lastUpdatedBy: AlphaVantageEndpoint; // Track which endpoint last updated this symbol
  lastUpdatedAt: FirebaseFirestore.FieldValue; // When this symbol was last updated
  nextRefreshAt: FirebaseFirestore.Timestamp; // When this symbol should be refreshed
  nextRefreshedBy: AlphaVantageEndpoint; // Which endpoint will handle the next refresh
  ttlSeconds: number;
}

/**
 * Saves Alpha Vantage data to Firestore with TTL and updates symbol metadata
 */
export async function saveAvData(
  data: any,
  symbol: string,
  endpoint: AlphaVantageEndpoint,
  ttlSeconds: number,
  config: { firestorePath?: string }
): Promise<void> {
  const batch = db.batch();
  const now = new Date();
  const nextRefreshAt = new Date(now.getTime() + ttlSeconds * 1000);
  
  try {
    // 1. Prepare the main data document
    const docData: StoredAvData = {
      data,
      metadata: {
        symbol,
        endpoint,
        lastUpdated: FieldValue.serverTimestamp(),
        nextRefreshAt: {
          _seconds: Math.floor(nextRefreshAt.getTime() / 1000),
          _nanoseconds: 0
        } as unknown as FirebaseFirestore.Timestamp,
        ttlSeconds
      }
    };

    // 2. Get the document path and save the main data
    const docPath = config.firestorePath?.replace('{symbol}', symbol) || 
                   `${FirestoreCollection.MARKET_DATA}/${symbol}/${FirestoreCollection.DATA_POINTS}/${endpoint}`;
    
    if (!config.firestorePath) {
      console.warn(`No firestorePath configured for endpoint: ${endpoint}, using default path`);
    }
    
    const docRef = db.doc(docPath);
    batch.set(docRef, docData, { merge: true });
    
    // 3. Create/update the symbol metadata document
    const symbolPath = docPath.split('/').slice(0, 2).join('/'); // Gets path up to symbol
    const symbolRef = db.doc(symbolPath);
    
    // Update the symbol metadata with this endpoint
    const symbolUpdate: Partial<SymbolMetadata> = {
      symbol,
      lastUpdatedBy: endpoint, // Track which endpoint made this update
      lastUpdatedAt: FieldValue.serverTimestamp(), // When this update occurred
      nextRefreshAt: {
        _seconds: Math.floor(nextRefreshAt.getTime() / 1000),
        _nanoseconds: 0
      } as unknown as FirebaseFirestore.Timestamp,
      nextRefreshedBy: endpoint, // This endpoint will handle the next refresh
      ttlSeconds,
      // Use arrayUnion to add this endpoint if not already present
      endpoints: FieldValue.arrayUnion(endpoint) as any
    };
    
    batch.set(symbolRef, symbolUpdate, { merge: true });
    
    // 4. Commit the batch
    await batch.commit();
    
    console.log(`Saved data for ${symbol}/${endpoint} to Firestore at path: ${docPath}`);
    console.log(`Updated symbol metadata at path: ${symbolPath}`);
  } catch (error) {
    console.error('Error saving data to Firestore:', error);
    throw error;
  }
}

/**
 * Retrieves Alpha Vantage data from Firestore if it exists and is not expired
 */
export async function getAvData(
  symbol: string,
  endpoint: AlphaVantageEndpoint
): Promise<StoredAvData | null> {
  try {
    const docPath = `${FirestoreCollection.MARKET_DATA}/${symbol}/${
      FirestoreCollection.DATA_POINTS
    }/${endpoint}`;
    
    const doc = await db.doc(docPath).get();
    
    if (!doc.exists) {
      return null;
    }
    
    const data = doc.data() as StoredAvData;
    const now = new Date();
    
    // Check if data is expired
    if (data.metadata.nextRefreshAt.toDate() < now) {
      return null;
    }
    
    return data;
  } catch (error) {
    console.error('Error getting data from Firestore:', error);
    return null;
  }
}

/**
 * Updates the refresh timestamp for a data point without changing the data
 */
export async function updateRefreshTime(
  symbol: string,
  endpoint: AlphaVantageEndpoint,
  ttlSeconds: number
): Promise<void> {
  const nextRefreshAt = new Date(Date.now() + ttlSeconds * 1000);
  
  await db
    .doc(
      `${FirestoreCollection.MARKET_DATA}/${symbol}/${
        FirestoreCollection.DATA_POINTS
      }/${endpoint}`
    )
    .set(
      {
        'metadata.lastUpdated': FieldValue.serverTimestamp(),
        'metadata.nextRefreshAt': {
          _seconds: Math.floor(nextRefreshAt.getTime() / 1000),
          _nanoseconds: 0
        },
        'metadata.ttlSeconds': ttlSeconds
      },
      { merge: true }
    );
}

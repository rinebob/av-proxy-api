import { db } from '../../firebase-admin-init';
import { FirestoreCollection } from '../common/firestore/firestore-collections';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { 
  AlphaVantageEndpoint, 
  DocumentMetadata, 
  DocumentType, 
  SaveConfig, 
  SymbolMetadata,
} from '../common/common-av';

import { TimeSeriesInterval } from '../common/common-fn';

/**
 * Saves Alpha Vantage data to Firestore with TTL and updates symbol metadata
 */
export async function saveAvData(
  data: any,
  symbol: string,
  endpoint: AlphaVantageEndpoint,
  config: SaveConfig = {}
): Promise<void> {
  const {
    firestorePath,
    documentType = DocumentType.STANDARD,
    ttlSeconds = 24 * 60 * 60, // Default 24 hours
    interval = TimeSeriesInterval.DAILY
  } = config;
  
  const batch = db.batch();
  const now = new Date();
  const nextRefresh = new Date(now.getTime() + ttlSeconds * 1000);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  
  try {
    // 1. Prepare the document data based on document type
    let docData: { data: any; metadata: DocumentMetadata };
    
    if (documentType === DocumentType.TIME_SERIES) {
      docData = {
        data,
        metadata: {
          symbol,
          interval,
          lastUpdate: FieldValue.serverTimestamp(),
          nextRefreshAt: tomorrow,
          quoteDataPoints: 0,
          firstQuoteDate: Timestamp.fromDate(tomorrow),
          histDataPoints: Array.isArray(data) ? data.length : 0,
          histStartDate: Array.isArray(data) && data.length > 0 && data[data.length - 1]?.date
            ? Timestamp.fromDate(new Date(data[data.length - 1].date))
            : Timestamp.now(),
          histEndDate: Array.isArray(data) && data.length > 0 && data[0]?.date
            ? Timestamp.fromDate(new Date(data[0].date))
            : Timestamp.now(),
          ttlSeconds
        } as DocumentMetadata
      };
    } else {
      docData = {
        data,
        metadata: {
          symbol,
          endpoint,
          lastUpdated: FieldValue.serverTimestamp(),
          nextRefreshAt: Timestamp.fromDate(nextRefresh),
          ttlSeconds
        }
      };
    }

    // 2. Get the document path and save the main data
    if (!firestorePath) {
      throw new Error(`No firestorePath configured for endpoint: ${endpoint}. A firestorePath must be provided.`);
    }
    
    const docPath = firestorePath.replace('{symbol}', symbol);
    const docRef = db.doc(documentType === DocumentType.TIME_SERIES 
      ? `${FirestoreCollection.TIME_SERIES}/${symbol}/${FirestoreCollection.DAILY}/${endpoint}`
      : docPath
    );
    
    batch.set(docRef, docData, { merge: true });
    
    // 3. Create/update the symbol metadata document if not a time series document
    if (documentType !== DocumentType.TIME_SERIES) {
      const symbolPath = docPath.split('/').slice(0, 2).join('/');
      const symbolRef = db.doc(symbolPath);
    
      const symbolUpdate: Partial<SymbolMetadata> = {
        symbol,
        lastUpdatedBy: endpoint,
        lastUpdatedAt: FieldValue.serverTimestamp(),
        nextRefreshAt: Timestamp.fromDate(nextRefresh),
        nextRefreshedBy: endpoint,
        ttlSeconds,
        endpoints: FieldValue.arrayUnion(endpoint) as any
      };
    
      batch.set(symbolRef, symbolUpdate, { merge: true });
    }
    
    // 4. Commit the batch
    await batch.commit();
    
    console.log(`Saved ${documentType} data for ${symbol}/${endpoint} at path: ${docPath}`);
  } catch (error) {
    console.error('Error saving data to Firestore:', error);
    throw error;
  }
}

import { db } from '../firebase-admin-init';
import { FieldValue } from 'firebase-admin/firestore';
import { 
  BzCompanyDataCalendarType,
  BzMarketDataCalendarType,
  isBzCompanyDataCalendarType,
  isBzMarketDataCalendarType,
  BzCalendarType
} from '../common/common-benz';
import { Firestore } from 'firebase-admin/firestore';
import { FirestoreCollection } from '../common/firestore-collections';

// Collection names
const LOGO_CACHE_COLLECTION = 'benzingaLogoCache';
const LOGO_CACHE_DURATION_DAYS = 30;

/**
 * Get a reference to a company data collection and ensure parent document exists with metadata
 */
export async function getCompanyDataCollection(
  db: Firestore, 
  symbol: string, 
  dataType: BzCompanyDataCalendarType
) {
  const symbolUpper = symbol.toUpperCase();
  const companyDocRef = db.collection(FirestoreCollection.COMPANY_DATA).doc(symbolUpper);
  
  // Initialize the company document if it doesn't exist
  await companyDocRef.set(
    {
      symbol: symbolUpper, 
      originalSymbol: symbol, 
      createdAt: FieldValue.serverTimestamp(),
      lastUpdated: FieldValue.serverTimestamp(),
      lastUpdatedBy: `calendar:${dataType}`,
      endpoints: {
        [dataType]: {
          dataInSubcollection: true,
          lastUpdated: FieldValue.serverTimestamp()
        }
      }
    },
    { merge: true }
  );
  
  return companyDocRef.collection(dataType);
}

/**
 * Get a reference to a market data collection and ensure parent document exists with metadata
 */
export async function getMarketDataCollection(
  db: Firestore,
  dataType: BzMarketDataCalendarType
) {
  const marketDocRef = db.collection(FirestoreCollection.MARKET_DATA).doc(dataType);
  
  // Initialize the market data document if it doesn't exist
  await marketDocRef.set(
    {
      dataType,
      createdAt: FieldValue.serverTimestamp(),
      lastUpdated: FieldValue.serverTimestamp(),
      lastUpdatedBy: `calendar:${dataType}`,
      dataInSubcollection: true
    },
    { merge: true }
  );
  
  return marketDocRef.collection('data');
}

/**
 * Get the appropriate collection reference based on endpoint type and symbol
 */
export async function getDataCollection(
  db: Firestore,
  endpoint: BzCalendarType,
  symbol?: string
) {
  if (isBzCompanyDataCalendarType(endpoint)) {
    if (!symbol) {
      throw new Error(`Symbol is required for ${endpoint} data`);
    }
    return getCompanyDataCollection(db, symbol, endpoint);
  }
  
  if (isBzMarketDataCalendarType(endpoint)) {
    return getMarketDataCollection(db, endpoint);
  }
  
  // This should never happen due to type guards, but provides a type-safe fallback
  throw new Error(`Unknown endpoint type: ${endpoint}`);
}

/**
 * Generate a consistent document ID with vendor prefix
 */
export function getVendorDocId(vendor: string, dataType: string): string {
  return `${vendor}-${dataType}`;
}

/**
 * Retrieves a cached company logo from Firestore if it's valid.
 */
export async function getLogoData(ticker: string): Promise<any | null> {
  const doc = await db.collection(LOGO_CACHE_COLLECTION).doc(ticker).get();
  
  if (!doc.exists) {
    console.log(`[${ticker}] NO LOGO CACHE FOUND`);
    return null;
  }
  
  const cacheData = doc.data();
  const cacheTime = cacheData?.cachedAt?.toDate();
  
  if (!cacheTime) {
    console.log(`[${ticker}] INVALID CACHE TIMESTAMP`);
    return null;
  }
  
  const expiryDate = new Date(cacheTime);
  expiryDate.setDate(expiryDate.getDate() + LOGO_CACHE_DURATION_DAYS);
  const isCacheExpired = new Date() > expiryDate;
  
  if (isCacheExpired) {
    console.log(`[${ticker}] LOGO CACHE EXPIRED`);
    return null;
  }

  return cacheData?.data || null;
}

/**
 * Saves company logo data to the Firestore cache.
 */
export async function saveLogoData(ticker: string, data: any): Promise<void> {
  const cachePayload = {
    cachedAt: FieldValue.serverTimestamp(),
    data,
  };

  await db.collection(LOGO_CACHE_COLLECTION).doc(ticker).set(cachePayload);
}

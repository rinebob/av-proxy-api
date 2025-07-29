import { DocumentPathOptions, VendorType } from '../refresh.types';
import { FirestoreCollection } from '../../common/firestore/firestore-collections';

/**
 * Generates the document path for a data document
 * @param options Vendor, endpoint, and optional symbol
 * @returns Full Firestore document path
 */
export function getDocumentPath({ vendor, endpoint, symbol }: DocumentPathOptions): string {
  const vendorPrefix = vendor.toLowerCase();
  const sanitizedEndpoint = endpoint.toUpperCase().replace(/\//g, '_');
  
  if (symbol) {
    // Company-specific data path: company-data/{symbol}/{endpoint}/{vendor}-{endpointName}
    return `${FirestoreCollection.COMPANY_DATA}/${symbol.toUpperCase()}/${sanitizedEndpoint}/${vendorPrefix}-${sanitizedEndpoint}`;
  }
  
  // Market-wide data path: market-data/{vendor}-{endpointName}
  return `${FirestoreCollection.MARKET_DATA}/${vendorPrefix}-${sanitizedEndpoint}`;
}

/**
 * Generates the path for a refresh history document
 * @param options Vendor, endpoint, and optional symbol
 * @param timestamp Optional timestamp (defaults to current time)
 * @returns Full Firestore document path for the refresh history entry
 */
export function getRefreshHistoryPath(
  { vendor, endpoint, symbol }: DocumentPathOptions,
  timestamp: FirebaseFirestore.Timestamp = FirebaseFirestore.Timestamp.now()
): string {
  const basePath = getDocumentPath({ vendor, endpoint, symbol });
  // Convert to ISO string and replace characters that aren't allowed in Firestore document IDs
  const timestampStr = timestamp.toDate().toISOString()
    .replace(/[:.]/g, '-')  // Replace colons and dots with hyphens
    .replace('T', '_');     // Replace T with underscore for readability
    
  return `${basePath}/${FirestoreCollection.REFRESH_HISTORY}/${timestampStr}`;
}

/**
 * Extracts components from a document path
 * @param path Firestore document path
 * @returns Parsed path components or null if invalid
 */
export function parseDocumentPath(path: string): { vendor: VendorType; endpoint: string; symbol: string | null } | null {
  const parts = path.split('/');
  
  // Market data path: market-data/{vendor}-{endpoint}
  if (path.startsWith(`${FirestoreCollection.MARKET_DATA}/`) && parts.length === 2) {
    const [vendorPrefix, endpoint] = parts[1].split('-', 2);
    return {
      vendor: vendorPrefix as VendorType,
      endpoint: endpoint.replace(/_/g, '/'), // Restore any slashes in endpoint
      symbol: null
    };
  }
  
  // Company data path: company-data/{symbol}/{endpoint}/{vendor}-{endpoint}
  if (path.startsWith(`${FirestoreCollection.COMPANY_DATA}/`) && parts.length === 4) {
    const symbol = parts[1];
    const [vendorPrefix, endpoint] = parts[3].split('-', 2);
    return {
      vendor: vendorPrefix as VendorType,
      endpoint: endpoint.replace(/_/g, '/'), // Restore any slashes in endpoint
      symbol
    };
  }
  
  return null;
}

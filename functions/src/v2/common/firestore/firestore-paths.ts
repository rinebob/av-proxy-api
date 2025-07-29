import { DocumentPathOptions } from '../refresh.types';
import { FirestoreCollection } from '../../common/firestore/firestore-collections';
import { DATA_PROVIDERS } from '../../common/data-providers';

/**
 * Generates the document path for a data document
 * @param options Vendor, endpoint, and optional symbol
 * @returns Full Firestore document path
 */
export function getDocumentPath({ vendor, endpoint, symbol }: DocumentPathOptions): string {
  const vendorPrefix = DATA_PROVIDERS[vendor].prefix;
  const sanitizedEndpoint = endpoint.toLowerCase().replace(/\//g, '_');
  
  if (symbol) {
    // Symbol-specific data path: symbol-data/{symbol}/{endpoint}/{vendorPrefix}-{endpoint}
    return `${FirestoreCollection.SYMBOL_DATA}/${symbol.toUpperCase()}/${sanitizedEndpoint}/${vendorPrefix}-${sanitizedEndpoint}`;
  }
  // Market-wide data path: market-data/{vendorPrefix}-{endpoint}
  return `${FirestoreCollection.MARKET_DATA}/${vendorPrefix}-${sanitizedEndpoint}`;
}

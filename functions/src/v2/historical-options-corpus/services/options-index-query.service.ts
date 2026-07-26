import type { Firestore } from 'firebase-admin/firestore';

import type { ContractResult } from '@shared/options';
import {
  OPTIONS_FILE_INDEX_COLLECTION,
  TS_EXPIRATIONS_SUBCOLLECTION,
  TS_STRIKES_SUBCOLLECTION,
  type ExpirationIndexDoc,
  type StrikeIndexDoc,
} from '@shared/options';

import { filterContractsByType } from './contract-result.utils';

/**
 * Queries the Firestore options-file-index for contract IDs matching the
 * provided filters. Shared by the admin storage-file-viewer and the
 * partner-facing list-contracts endpoint.
 *
 * @param db Firestore instance (admin SDK).
 * @param symbol Upper-cased symbol, e.g. `QQQ`.
 * @param expiration Optional expiration date (`YYYY-MM-DD`).
 * @param strike Optional strike price (dollars).
 * @param type Optional option type filter (`'C'` or `'P'`).
 * @returns Array of parsed {@link ContractResult} objects.
 */
export async function queryContractsByFilters(
  db: Firestore,
  symbol: string,
  expiration?: string | null,
  strike?: number | null,
  type?: 'C' | 'P' | null,
): Promise<ContractResult[]> {
  const symbolDocRef = db.collection(OPTIONS_FILE_INDEX_COLLECTION).doc(symbol);

  const hasExpiration = !!expiration;
  const hasStrike = strike !== undefined && strike !== null;

  // Path 1: symbol + expiration (no strike)
  if (hasExpiration && !hasStrike) {
    const expDoc = await symbolDocRef.collection(TS_EXPIRATIONS_SUBCOLLECTION).doc(expiration!).get();
    if (!expDoc.exists) return [];
    const doc = expDoc.data() as ExpirationIndexDoc;
    return filterContractsByType(doc.contractIds, symbol, type);
  }

  // Path 2: symbol + strike (no expiration)
  if (hasStrike && !hasExpiration) {
    const strikeDoc = await symbolDocRef.collection(TS_STRIKES_SUBCOLLECTION).doc(String(strike)).get();
    if (!strikeDoc.exists) return [];
    const doc = strikeDoc.data() as StrikeIndexDoc;
    return filterContractsByType(doc.contractIds, symbol, type);
  }

  // Path 3: symbol + expiration + strike → intersect
  if (hasExpiration && hasStrike) {
    const [expDoc, strikeDoc] = await Promise.all([
      symbolDocRef.collection(TS_EXPIRATIONS_SUBCOLLECTION).doc(expiration!).get(),
      symbolDocRef.collection(TS_STRIKES_SUBCOLLECTION).doc(String(strike)).get(),
    ]);

    if (!expDoc.exists || !strikeDoc.exists) return [];

    const expData = expDoc.data() as ExpirationIndexDoc;
    const strikeData = strikeDoc.data() as StrikeIndexDoc;
    const expSet = new Set(expData.contractIds);
    const intersection = strikeData.contractIds.filter((id) => expSet.has(id));
    return filterContractsByType(intersection, symbol, type);
  }

  // Path 4: symbol only → list all expirations
  const expSnap = await symbolDocRef.collection(TS_EXPIRATIONS_SUBCOLLECTION).get();
  const allIds: string[] = [];
  for (const doc of expSnap.docs) {
    const docData = doc.data() as ExpirationIndexDoc;
    allIds.push(...docData.contractIds);
  }
  return filterContractsByType(allIds, symbol, type);
}

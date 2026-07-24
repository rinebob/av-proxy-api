import { HttpsError } from 'firebase-functions/v2/https';
import { getStorage } from 'firebase-admin/storage';
import type { Firestore } from 'firebase-admin/firestore';

import {
  OPTIONS_FILE_INDEX_COLLECTION,
  TS_EXPIRATIONS_SUBCOLLECTION,
  TS_STRIKES_SUBCOLLECTION,
  type ExpirationIndexDoc,
  type StrikeIndexDoc,
} from './options-index.writer';
import { parseContractIDMetadata } from './contract-metadata.utils';
import { TIME_SERIES_PREFIX, HISTORICAL_OPTIONS_CORPUS_PREFIX } from '../types';
import { GcsTimeSeriesAdapter } from './gcs-time-series-adapter.service';
import { GcsCorpusAdapter } from './gcs-corpus-adapter.service';

export type BucketName = 'time-series' | 'corpus';

export interface ContractResult {
  contractId: string;
  expiration: string;
  strike: number;
  type: string;
}

export interface ListTimeSeriesResult {
  bucket: 'time-series';
  symbol: string;
  contracts: ContractResult[];
  count: number;
}

export interface ListCorpusResult {
  bucket: 'corpus';
  symbol: string;
  dates: string[];
  count: number;
}

export interface ReadResult {
  bucket: BucketName;
  path: string;
  content: string;
  bytes: number;
}

const PAGE_SIZE = 1000;

/**
 * Service for the Storage File Viewer.
 *
 * Handles Firestore index queries, GCS file reads, and contract filtering.
 * The HTTP handler delegates here after auth checks.
 */
export class StorageFileViewerService {
  constructor(private readonly db: Firestore) {}

  async listTimeSeries(
    symbol: string,
    expiration?: string,
    strike?: number,
    type?: 'C' | 'P',
  ): Promise<ListTimeSeriesResult> {
    const upperSymbol = symbol.toUpperCase();
    const symbolDocRef = this.db.collection(OPTIONS_FILE_INDEX_COLLECTION).doc(upperSymbol);

    // Path 1: symbol + expiration → get strikes and contract IDs from expiration doc
    if (expiration && strike === undefined) {
      const expDoc = await symbolDocRef.collection(TS_EXPIRATIONS_SUBCOLLECTION).doc(expiration).get();
      if (!expDoc.exists) {
        return { bucket: 'time-series', symbol: upperSymbol, contracts: [], count: 0 };
      }
      const doc = expDoc.data() as ExpirationIndexDoc;
      const contracts = filterContractsByType(doc.contractIds, upperSymbol, type);
      return { bucket: 'time-series', symbol: upperSymbol, contracts, count: contracts.length };
    }

    // Path 2: symbol + strike → get expirations and contract IDs from strike doc
    if (strike !== undefined && !expiration) {
      const strikeDoc = await symbolDocRef.collection(TS_STRIKES_SUBCOLLECTION).doc(String(strike)).get();
      if (!strikeDoc.exists) {
        return { bucket: 'time-series', symbol: upperSymbol, contracts: [], count: 0 };
      }
      const doc = strikeDoc.data() as StrikeIndexDoc;
      const contracts = filterContractsByType(doc.contractIds, upperSymbol, type);
      return { bucket: 'time-series', symbol: upperSymbol, contracts, count: contracts.length };
    }

    // Path 3: symbol + expiration + strike → intersect contract IDs
    if (expiration && strike !== undefined) {
      const [expDoc, strikeDoc] = await Promise.all([
        symbolDocRef.collection(TS_EXPIRATIONS_SUBCOLLECTION).doc(expiration).get(),
        symbolDocRef.collection(TS_STRIKES_SUBCOLLECTION).doc(String(strike)).get(),
      ]);

      if (!expDoc.exists || !strikeDoc.exists) {
        return { bucket: 'time-series', symbol: upperSymbol, contracts: [], count: 0 };
      }

      const expData = expDoc.data() as ExpirationIndexDoc;
      const strikeData = strikeDoc.data() as StrikeIndexDoc;
      const expSet = new Set(expData.contractIds);
      const intersection = strikeData.contractIds.filter((id) => expSet.has(id));
      const contracts = filterContractsByType(intersection, upperSymbol, type);
      return { bucket: 'time-series', symbol: upperSymbol, contracts, count: contracts.length };
    }

    // Path 4: symbol only → list all expirations
    if (!expiration && strike === undefined) {
      const expSnap = await symbolDocRef.collection(TS_EXPIRATIONS_SUBCOLLECTION).get();
      const contracts: ContractResult[] = [];
      for (const doc of expSnap.docs) {
        const docData = doc.data() as ExpirationIndexDoc;
        for (const id of docData.contractIds) {
          if (type && !id.includes(type === 'C' ? 'C' : 'P')) continue;
          const parsed = parseContractResult(upperSymbol, id);
          if (parsed) contracts.push(parsed);
        }
      }
      return { bucket: 'time-series', symbol: upperSymbol, contracts, count: contracts.length };
    }

    throw new HttpsError('invalid-argument', 'Unsupported filter combination.');
  }

  async listCorpus(symbol: string): Promise<ListCorpusResult> {
    const upperSymbol = symbol.toUpperCase();
    const bucketName = process.env.OPTIONS_CORPUS_BUCKET;
    if (!bucketName) {
      throw new HttpsError('internal', 'OPTIONS_CORPUS_BUCKET not configured.');
    }

    const bucket = getStorage().bucket(bucketName);
    const prefix = `${HISTORICAL_OPTIONS_CORPUS_PREFIX}/${upperSymbol}/`;

    const dates: string[] = [];
    let pageToken: string | undefined;

    for (;;) {
      const [files, , apiResponse] = await bucket.getFiles({
        prefix,
        maxResults: PAGE_SIZE,
        pageToken,
      });

      for (const file of files) {
        const relativePath = file.name.slice(prefix.length);
        if (!relativePath.endsWith('.json.gz')) continue;
        const date = relativePath.replace(/\.json\.gz$/, '');
        if (date) dates.push(date);
      }

      const nextPageToken = (apiResponse as any)?.nextPageToken;
      if (!nextPageToken || nextPageToken === pageToken) break;
      pageToken = nextPageToken;
    }

    dates.sort();
    return { bucket: 'corpus', symbol: upperSymbol, dates, count: dates.length };
  }

  async readTimeSeries(symbol: string, contractId: string): Promise<ReadResult> {
    const upperSymbol = symbol.toUpperCase();
    const upperContractId = contractId.toUpperCase();
    const bucketName = process.env.OPTIONS_TIME_SERIES_BUCKET;
    if (!bucketName) {
      throw new HttpsError('internal', 'OPTIONS_TIME_SERIES_BUCKET not configured.');
    }

    const bucket = getStorage().bucket(bucketName);
    const adapter = new GcsTimeSeriesAdapter(bucket);

    const lines = await adapter.readLines(upperSymbol, upperContractId);
    if (lines === undefined) {
      throw new HttpsError('not-found', `File not found: ${TIME_SERIES_PREFIX}/${upperSymbol}/${upperContractId}.jsonl`);
    }

    const content = lines.join('\n');
    const path = `${TIME_SERIES_PREFIX}/${upperSymbol}/${upperContractId}.jsonl`;
    return { bucket: 'time-series', path, content, bytes: content.length };
  }

  async readCorpus(symbol: string, date: string): Promise<ReadResult> {
    const upperSymbol = symbol.toUpperCase();
    const bucketName = process.env.OPTIONS_CORPUS_BUCKET;
    if (!bucketName) {
      throw new HttpsError('internal', 'OPTIONS_CORPUS_BUCKET not configured.');
    }

    const bucket = getStorage().bucket(bucketName);
    const adapter = new GcsCorpusAdapter(bucket);

    const result = await adapter.readItem(upperSymbol, date);
    if (result.status === 'NOT_FOUND') {
      throw new HttpsError('not-found', `File not found: ${HISTORICAL_OPTIONS_CORPUS_PREFIX}/${upperSymbol}/${date}.json.gz`);
    }
    if (result.status === 'CORRUPT') {
      throw new HttpsError('internal', `Corrupt file: ${result.reason}`);
    }

    const content = JSON.stringify(result.envelope, null, 2);
    const path = `${HISTORICAL_OPTIONS_CORPUS_PREFIX}/${upperSymbol}/${date}.json.gz`;
    return { bucket: 'corpus', path, content, bytes: content.length };
  }
}

/**
 * Parses an OCC contract ID into a ContractResult using the canonical
 * parseContractIDMetadata utility. Returns null if invalid.
 */
function parseContractResult(symbol: string, contractId: string): ContractResult | null {
  const meta = parseContractIDMetadata(symbol, contractId);
  if (!meta) return null;

  const strikeNumeric = Number(meta.strike);
  if (!Number.isFinite(strikeNumeric)) return null;

  return {
    contractId: contractId.toUpperCase(),
    expiration: meta.expiration,
    strike: strikeNumeric / 1000,
    type: meta.type,
  };
}

function filterContractsByType(contractIds: string[], symbol: string, type?: 'C' | 'P'): ContractResult[] {
  const contracts: ContractResult[] = [];
  for (const id of contractIds) {
    const parsed = parseContractResult(symbol, id);
    if (!parsed) continue;
    if (type && parsed.type !== (type === 'C' ? 'call' : 'put')) continue;
    contracts.push(parsed);
  }
  return contracts;
}

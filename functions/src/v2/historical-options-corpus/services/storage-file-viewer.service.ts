import { HttpsError } from 'firebase-functions/v2/https';
import { getStorage } from 'firebase-admin/storage';
import type { Firestore } from 'firebase-admin/firestore';

import type {
  ListTimeSeriesResult,
  ListCorpusResult,
  ReadResult,
  CorpusFileEntry,
} from '@shared/options';

import { queryContractsByFilters } from './options-index-query.service';
import { TIME_SERIES_PREFIX, HISTORICAL_OPTIONS_CORPUS_PREFIX } from '../types';
import { GcsTimeSeriesAdapter } from './gcs-time-series-adapter.service';
import { GcsCorpusAdapter } from './gcs-corpus-adapter.service';

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
    const contracts = await queryContractsByFilters(
      this.db,
      upperSymbol,
      expiration,
      strike,
      type,
    );
    return { bucket: 'time-series', symbol: upperSymbol, contracts, count: contracts.length };
  }

  async listCorpus(symbol: string): Promise<ListCorpusResult> {
    const upperSymbol = symbol.toUpperCase();
    const bucketName = process.env.OPTIONS_CORPUS_BUCKET;
    if (!bucketName) {
      throw new HttpsError('internal', 'OPTIONS_CORPUS_BUCKET not configured.');
    }

    const bucket = getStorage().bucket(bucketName);
    const prefix = `${HISTORICAL_OPTIONS_CORPUS_PREFIX}/${upperSymbol}/`;

    const files: CorpusFileEntry[] = [];
    let pageToken: string | undefined;

    for (;;) {
      const [gcsFiles, , apiResponse] = await bucket.getFiles({
        prefix,
        maxResults: PAGE_SIZE,
        pageToken,
      });

      for (const file of gcsFiles) {
        const relativePath = file.name.slice(prefix.length);
        if (!relativePath.endsWith('.json.gz')) continue;
        const date = relativePath.replace(/\.json\.gz$/, '');
        if (!date) continue;
        const [metadata] = await file.getMetadata();
        files.push({
          date,
          size: Number(metadata.size) || 0,
          generation: String(metadata.generation ?? ''),
          updated: metadata.updated ?? '',
        });
      }

      const nextPageToken = (apiResponse as any)?.nextPageToken;
      if (!nextPageToken || nextPageToken === pageToken) break;
      pageToken = nextPageToken;
    }

    files.sort((a, b) => a.date.localeCompare(b.date));
    const dates = files.map((f) => f.date);
    return { bucket: 'corpus', symbol: upperSymbol, dates, files, count: files.length };
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

    const [lines, metadata] = await Promise.all([
      adapter.readLines(upperSymbol, upperContractId),
      adapter.getMetadata(upperSymbol, upperContractId),
    ]);

    if (lines === undefined) {
      throw new HttpsError('not-found', `File not found: ${TIME_SERIES_PREFIX}/${upperSymbol}/${upperContractId}.jsonl`);
    }

    const content = lines.join('\n');
    const path = `${TIME_SERIES_PREFIX}/${upperSymbol}/${upperContractId}.jsonl`;
    return { bucket: 'time-series', path, content, bytes: content.length, metadata };
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


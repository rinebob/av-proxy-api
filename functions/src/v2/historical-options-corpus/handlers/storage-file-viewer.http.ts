import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';

import { db } from '../../../firebase-admin-init';
import { StorageFileViewerService } from '../services/storage-file-viewer.service';

interface ListTimeSeriesRequest {
  action: 'list';
  bucket: 'time-series';
  symbol: string;
  expiration?: string;
  strike?: number;
  type?: 'C' | 'P';
}

interface ListCorpusRequest {
  action: 'list';
  bucket: 'corpus';
  symbol: string;
}

interface ReadTimeSeriesRequest {
  action: 'read';
  bucket: 'time-series';
  symbol: string;
  contractId: string;
}

interface ReadCorpusRequest {
  action: 'read';
  bucket: 'corpus';
  symbol: string;
  date: string;
}

type StorageViewerRequest = ListTimeSeriesRequest | ListCorpusRequest | ReadTimeSeriesRequest | ReadCorpusRequest;

/**
 * Admin-only onCall function for the Storage File Viewer.
 *
 * Requires Firebase Auth with `admin` custom claim.
 *
 * Actions:
 * - `list` + `time-series`: queries the Firestore index for contracts matching symbol/expiration/strike/type
 * - `list` + `corpus`: lists available dates in the corpus bucket for a symbol
 * - `read` + `time-series`: downloads a JSONL file from the time-series bucket
 * - `read` + `corpus`: downloads a gzipped JSON file from the corpus bucket
 */
export const storageFileViewer = onCall<StorageViewerRequest>(
  { cors: true, memory: '1GiB', timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    if (!request.auth.token.admin) {
      throw new HttpsError('permission-denied', 'Admin role required.');
    }

    const data = request.data;
    const service = new StorageFileViewerService(db);

    if (data.action === 'list' && data.bucket === 'time-series') {
      logger.info('storageFileViewer.list.time-series', { symbol: data.symbol, expiration: data.expiration, strike: data.strike, type: data.type });
      return await service.listTimeSeries(data.symbol, data.expiration, data.strike, data.type);
    }

    if (data.action === 'list' && data.bucket === 'corpus') {
      logger.info('storageFileViewer.list.corpus', { symbol: data.symbol });
      return await service.listCorpus(data.symbol);
    }

    if (data.action === 'read' && data.bucket === 'time-series') {
      logger.info('storageFileViewer.read.time-series', { symbol: data.symbol, contractId: data.contractId });
      return await service.readTimeSeries(data.symbol, data.contractId);
    }

    if (data.action === 'read' && data.bucket === 'corpus') {
      logger.info('storageFileViewer.read.corpus', { symbol: data.symbol, date: data.date });
      return await service.readCorpus(data.symbol, data.date);
    }

    throw new HttpsError('invalid-argument', 'Unsupported action/bucket combination.');
  },
);

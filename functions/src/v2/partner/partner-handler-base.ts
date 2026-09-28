/**
 * Shared infrastructure for partner HTTPS endpoint handlers.
 *
 * Extracts the common boilerplate (secrets, GCS adapter factory, allowed symbols)
 * that was duplicated across every partner endpoint file.
 */

import type { Bucket } from '@google-cloud/storage';
import { getStorage } from 'firebase-admin/storage';
import { defineSecret } from 'firebase-functions/params';

import { GcsTimeSeriesAdapter } from '../historical-options-corpus/services/gcs-time-series-adapter.service';
import { optionsTimeSeriesBucket } from '../historical-options-corpus/types';

// ── Secrets ─────────────────────────────────────────────────────────────────

export const allowedServiceAccounts = defineSecret('ALLOWED_SERVICE_ACCOUNT_EMAILS');
export const expectedGoogleAudience = defineSecret('EXPECTED_GOOGLE_AUDIENCE');

// ── GCS adapter factory ─────────────────────────────────────────────────────

export interface GcsAdapterPair {
  adapter: GcsTimeSeriesAdapter;
  bucket: Bucket;
}

/**
 * Creates a `GcsAdapterPair` for the time-series bucket — `OPTIONS_TIME_SERIES_BUCKET`
 * env override or the fixed prod bucket default.
 */
export function defaultGetGcs(): GcsAdapterPair {
  const bucket = getStorage().bucket(optionsTimeSeriesBucket());
  return { adapter: new GcsTimeSeriesAdapter(bucket), bucket };
}

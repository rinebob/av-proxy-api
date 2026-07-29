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
import { ALLOWED_SYMBOLS } from '@shared/core';

// ── Secrets ─────────────────────────────────────────────────────────────────

export const allowedServiceAccounts = defineSecret('ALLOWED_SERVICE_ACCOUNT_EMAILS');
export const expectedGoogleAudience = defineSecret('EXPECTED_GOOGLE_AUDIENCE');

// ── Constants ───────────────────────────────────────────────────────────────

export { ALLOWED_SYMBOLS };

// ── GCS adapter factory ─────────────────────────────────────────────────────

export interface GcsAdapterPair {
  adapter: GcsTimeSeriesAdapter;
  bucket: Bucket;
}

/**
 * Creates a `GcsAdapterPair` from the `OPTIONS_TIME_SERIES_BUCKET` env var.
 * Throws if the env var is not configured.
 */
export function defaultGetGcs(): GcsAdapterPair {
  const bucketName = process.env.OPTIONS_TIME_SERIES_BUCKET;
  if (!bucketName) {
    throw new Error('OPTIONS_TIME_SERIES_BUCKET environment variable is not configured');
  }
  const bucket = getStorage().bucket(bucketName);
  return { adapter: new GcsTimeSeriesAdapter(bucket), bucket };
}

import type { Bucket, SaveOptions } from '@google-cloud/storage';

import { getTimeSeriesObjectPath } from './gcs-time-series-path.utils';
import { TIME_SERIES_PREFIX } from '../types';

const WRITE_RETRIES = 3;
const WRITE_RETRY_BASE_MS = 250;
const RETRYABLE_NETWORK_CODES = ['EPIPE', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED'];

export interface GcsTimeSeriesWriteResult {
  gcsPath: string;
  generation: string;
  bytes: number;
}

export class GcsTimeSeriesWriteError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = 'GcsTimeSeriesWriteError';
  }
}

/**
 * GCS adapter for per-contract historical options time series.
 *
 * Object layout: `{prefix}/{SYMBOL}/{CONTRACT_ID}.jsonl`
 *
 * Each object is newline-delimited JSON, one ordered observation per line.
 * The adapter is intentionally small: it reads and writes whole files. Large
 * contracts are still small enough that a full-file read is faster than
 * range requests and avoids extra index complexity.
 */
export class GcsTimeSeriesAdapter {
  constructor(
    private readonly bucket: Bucket,
    private readonly prefix = TIME_SERIES_PREFIX,
  ) {}

  getObjectPath(symbol: string, contractID: string): string {
    return getTimeSeriesObjectPath(symbol, contractID, this.prefix);
  }

  private getFile(symbol: string, contractID: string) {
    return this.bucket.file(this.getObjectPath(symbol, contractID));
  }

  /**
   * Downloads the per-contract JSONL file and returns its non-empty lines.
   * Returns undefined when the object does not exist.
   */
  async readLines(symbol: string, contractID: string): Promise<string[] | undefined> {
    const file = this.getFile(symbol, contractID);

    try {
      const [exists] = await file.exists();
      if (!exists) {
        return undefined;
      }

      const [buffer] = await file.download();
      return buffer
        .toString('utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    } catch (error: any) {
      if (error?.code === 404) {
        return undefined;
      }

      throw new GcsTimeSeriesWriteError(
        `Read failed for ${this.getObjectPath(symbol, contractID)}: ${String(error?.message ?? error)}`,
        'READ_FAILED',
        error,
      );
    }
  }

  /**
   * Writes the per-contract JSONL file. This is an unconditional overwrite;
   * the caller is responsible for building the complete merged contents.
   */
  async writeLines(
    symbol: string,
    contractID: string,
    lines: string[],
    customMetadata?: Record<string, string>,
  ): Promise<GcsTimeSeriesWriteResult> {
    const path = this.getObjectPath(symbol, contractID);
    const file = this.getFile(symbol, contractID);
    const content = lines.length > 0 ? `${lines.join('\n')}\n` : '';

    const metadata: { contentType: string; metadata?: Record<string, string> } = {
      contentType: 'application/x-ndjson',
    };
    if (customMetadata) {
      metadata.metadata = customMetadata;
    }

    const saveOptions: SaveOptions = {
      resumable: false,
      validation: 'crc32c',
      metadata,
    };

    let lastError: unknown;
    for (let attempt = 1; attempt <= WRITE_RETRIES; attempt++) {
      try {
        await file.save(content, saveOptions);
        lastError = undefined;
        break;
      } catch (error: any) {
        lastError = error;
        const message = String(error?.message ?? error);
        const isRetryable = RETRYABLE_NETWORK_CODES.some((code) => message.includes(code));
        if (!isRetryable || attempt === WRITE_RETRIES) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, WRITE_RETRY_BASE_MS * 2 ** (attempt - 1)));
      }
    }

    if (lastError) {
      throw new GcsTimeSeriesWriteError(
        `Write failed for ${path}: ${String((lastError as any)?.message ?? lastError)}`,
        'WRITE_FAILED',
        lastError,
      );
    }

    const [storedMetadata] = await file.getMetadata();
    return {
      gcsPath: path,
      generation: String(storedMetadata?.generation ?? ''),
      bytes: Number(storedMetadata?.size ?? 0),
    };
  }

}

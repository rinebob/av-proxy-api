import type { Bucket, File } from '@google-cloud/storage';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

import type {
  AvHistoricalOptionsResponse,
  SvtOptionsAnalysis,
} from '@shared/alpha-vantage';

import {
  HISTORICAL_OPTIONS_CORPUS_PREFIX,
  type CorpusItemKind,
  type CorpusReadResult,
  type HistoricalOptionsCorpusEnvelope,
} from '../types';

export interface GcsWriteResult {
  gcsPath: string;
  bytes: number;
  sha256: string;
  generation: string;
  alreadyExists: boolean;
}

/** Lightweight listing entry for a stored corpus object. */
export interface GcsCorpusObjectRef {
  date: string;
  /** Seed provenance stamp, absent for objects written without a kind. */
  kind?: CorpusItemKind;
}

export interface GcsCorpusMetadata {
  gcsPath: string;
  bytes: number;
  sha256: string;
  generation: string;
  version: string;
  schema: string;
  symbol: string;
  date: string;
}

export class GcsCorpusWriteError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = 'GcsCorpusWriteError';
  }
}

/**
 * GCS adapter for the versioned, gzipped, immutable historical options corpus.
 *
 * Object layout: `{prefix}/{SYMBOL}/{YYYY-MM-DD}.json.gz`
 *
 * Each object is a v1 envelope containing the AV response, analysis, and a
 * SHA-256 checksum. Writes are conditional (`ifGenerationMatch: 0`) so a
 * previously-stored object is never overwritten silently.
 */
export class GcsCorpusAdapter {
  constructor(
    private readonly bucket: Bucket,
    private readonly prefix = HISTORICAL_OPTIONS_CORPUS_PREFIX,
  ) {}

  getObjectPath(symbol: string, date: string): string {
    return `${this.prefix}/${symbol.toUpperCase()}/${date}.json.gz`;
  }

  private getFile(symbol: string, date: string): File {
    return this.bucket.file(this.getObjectPath(symbol, date));
  }

  /**
   * Reads the committed GCS object metadata to build a faithful `GcsWriteResult`.
   * Used both after a successful save and after a 412 "already exists" response.
   */
  private async loadStoredWriteResult(
    file: File,
    path: string,
    fallbackBytes: number,
    alreadyExists: boolean,
  ): Promise<GcsWriteResult> {
    const [metadata] = await file.getMetadata();
    const custom = (metadata?.metadata as Record<string, string> | undefined) ?? {};
    const storedSize = Number(metadata?.size);

    return {
      gcsPath: path,
      bytes: Number.isFinite(storedSize) ? storedSize : fallbackBytes,
      sha256: custom.sha256 ?? '',
      generation: String(metadata?.generation ?? ''),
      alreadyExists,
    };
  }

  /**
   * Lists stored corpus objects for a symbol as `{date, kind}` refs — used by
   * the sweep to diff coverage and find superseded interim snapshots.
   */
  async listItems(symbol: string): Promise<GcsCorpusObjectRef[]> {
    const prefix = `${this.prefix}/${symbol.toUpperCase()}/`;
    const [files] = await this.bucket.getFiles({ prefix });
    const refs: GcsCorpusObjectRef[] = [];
    for (const file of files) {
      const match = /\/(\d{4}-\d{2}-\d{2})\.json\.gz$/.exec(file.name);
      if (!match) continue;
      refs.push({
        date: match[1],
        kind: (file.metadata?.metadata as Record<string, string> | undefined)?.kind as CorpusItemKind | undefined,
      });
    }
    return refs;
  }

  /**
   * Deletes a stored corpus object. Used to retire superseded interim
   * snapshots — returns false when the object doesn't exist.
   */
  async deleteItem(symbol: string, date: string): Promise<boolean> {
    const file = this.getFile(symbol, date);
    try {
      await file.delete();
      return true;
    } catch (error: any) {
      if (error?.code === 404) return false;
      throw error;
    }
  }

  /**
   * Serializes and uploads a corpus item. Returns the stored object path,
   * size, and checksum. `alreadyExists` is true when the conditional write
   * failed because the object was already present. `kind` stamps the object's
   * provenance metadata (pivot fanout 'confirmed'/'interim' — Task #154).
   */
  async writeItem(
    symbol: string,
    date: string,
    response: AvHistoricalOptionsResponse,
    analysis: SvtOptionsAnalysis,
    kind?: CorpusItemKind,
  ): Promise<GcsWriteResult> {
    const envelope = this.buildEnvelope(symbol, date, response, analysis);
    const serialized = JSON.stringify(envelope);
    const compressed = gzipSync(serialized);
    const path = this.getObjectPath(symbol, date);

    const file = this.bucket.file(path);

    try {
      await file.save(compressed, {
        resumable: false,
        metadata: {
          contentType: 'application/gzip',
          metadata: {
            symbol: symbol.toUpperCase(),
            date,
            version: envelope.version,
            schema: envelope.schema,
            sha256: envelope.checksum.value,
            ...(kind ? { kind } : {}),
          },
        },
        ifGenerationMatch: 0,
        validation: 'crc32c',
      } as any);
    } catch (error: any) {
      if (error?.code === 412) {
        return await this.loadStoredWriteResult(file, path, compressed.length, true);
      }
      throw new GcsCorpusWriteError(
        `GCS write failed for ${path}: ${String(error?.message ?? error)}`,
        'WRITE_FAILED',
        error,
      );
    }

    return await this.loadStoredWriteResult(file, path, compressed.length, false);
  }

  /**
   * Downloads, decompresses, and validates a corpus item.
   *
   * Returns a typed `CorpusReadResult` without ever falling back to Alpha Vantage.
   */
  async readItem(symbol: string, date: string): Promise<CorpusReadResult> {
    const file = this.getFile(symbol, date);

    try {
      const [exists] = await file.exists();
      if (!exists) {
        return { status: 'NOT_FOUND' };
      }

      const [compressed] = await file.download();
      const serialized = gunzipSync(compressed).toString('utf8');
      const envelope: HistoricalOptionsCorpusEnvelope = JSON.parse(serialized);

      const verified = this.verifyEnvelope(envelope);
      if (!verified.ok) {
        return { status: 'CORRUPT', reason: verified.reason };
      }

      return {
        status: 'FOUND',
        response: envelope.response,
        analysis: envelope.analysis,
        envelope,
        bytes: compressed.length,
      };
    } catch (error: any) {
      if (error?.code === 404) {
        return { status: 'NOT_FOUND' };
      }
      return { status: 'CORRUPT', reason: String(error?.message ?? error) };
    }
  }

  /**
   * Reads object metadata without downloading the gzipped payload.
   *
   * Use this for cheap existence/skip checks; use `readItem` when you need the
   * response body or want full checksum verification.
   */
  async getMetadata(symbol: string, date: string): Promise<GcsCorpusMetadata | undefined> {
    const path = this.getObjectPath(symbol, date);
    const file = this.bucket.file(path);

    try {
      const [metadata] = await file.getMetadata();
      const custom = (metadata?.metadata as Record<string, string> | undefined) ?? {};

      return {
        gcsPath: path,
        bytes: Number(metadata?.size ?? 0) || 0,
        sha256: custom.sha256 ?? '',
        generation: String(metadata?.generation ?? ''),
        version: custom.version ?? '',
        schema: custom.schema ?? '',
        symbol: custom.symbol ?? symbol.toUpperCase(),
        date: custom.date ?? date,
      };
    } catch (error: any) {
      if (error?.code === 404) {
        return undefined;
      }
      throw new GcsCorpusWriteError(
        `GCS metadata read failed for ${path}: ${String(error?.message ?? error)}`,
        'METADATA_READ_FAILED',
        error,
      );
    }
  }

  private buildEnvelope(
    symbol: string,
    date: string,
    response: AvHistoricalOptionsResponse,
    analysis: SvtOptionsAnalysis,
  ): HistoricalOptionsCorpusEnvelope {
    // generatedAt is metadata, not part of the integrity payload, so the same
    // symbol+date+AV response always yields the same checksum.
    const generatedAt = new Date().toISOString();
    const payload = {
      version: 'v1' as const,
      schema: 'historical-options' as const,
      symbol: symbol.toUpperCase(),
      date,
      response,
      analysis,
    };

    const checksum = this.computeSha256(payload);

    return {
      ...payload,
      generatedAt,
      checksum: {
        algorithm: 'sha256' as const,
        value: checksum,
      },
    };
  }

  private computeSha256(payload: object): string {
    return createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');
  }

  private verifyEnvelope(
    envelope: HistoricalOptionsCorpusEnvelope,
  ): { ok: true } | { ok: false; reason: string } {
    if (envelope.version !== 'v1') {
      return { ok: false, reason: `Unsupported envelope version: ${envelope.version}` };
    }
    if (envelope.schema !== 'historical-options') {
      return { ok: false, reason: `Unsupported envelope schema: ${envelope.schema}` };
    }
    if (!envelope.checksum || envelope.checksum.algorithm !== 'sha256' || !envelope.checksum.value) {
      return { ok: false, reason: 'Envelope is missing a valid checksum' };
    }

    const { checksum, generatedAt, ...payload } = envelope;
    void generatedAt;
    const expected = this.computeSha256(payload);
    if (expected !== checksum.value) {
      return { ok: false, reason: 'Checksum mismatch: stored data may be corrupt' };
    }

    return { ok: true };
  }
}

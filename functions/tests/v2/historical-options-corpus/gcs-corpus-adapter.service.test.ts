import type { Bucket, File } from '@google-cloud/storage';

import {
  AvHistoricalOptionsResponse,
  AvOptionType,
  SvtOptionsAnalysis,
} from '@shared/alpha-vantage';

import { GcsCorpusAdapter } from '../../../src/v2/historical-options-corpus/services/gcs-corpus-adapter.service';

interface FakeFile {
  name: string;
  data?: Buffer;
  generation?: number;
  metadata?: Record<string, string>;
  save: jest.Mock;
  exists: jest.Mock;
  download: jest.Mock;
  getMetadata: jest.Mock;
  setMetadata: jest.Mock;
  delete: jest.Mock;
}

function createFakeBucket(): { bucket: Bucket; files: Map<string, FakeFile> } {
  const files = new Map<string, FakeFile>();
  let generationCounter = 1;

  const bucket = {
    getFiles: jest.fn().mockImplementation(async (options?: { prefix?: string }) => {
      // Real GCS only lists objects that exist — bucket.file() eagerly
      // creates a handle, so never-written names must not leak into listings.
      return [[...files.values()]
        .filter((f) => f.data !== undefined)
        .filter((f) => !options?.prefix || f.name.startsWith(options.prefix))
        .map((f) => ({
          name: f.name,
          metadata: { metadata: f.metadata ?? {} },
        }))];
    }),
    file(name: string): File {
      if (!files.has(name)) {
        files.set(name, {
          name,
          data: undefined,
          generation: undefined,
          save: jest.fn().mockImplementation(async (data: Buffer, options?: {
            metadata?: { metadata?: Record<string, string> };
            preconditionOpts?: { ifGenerationMatch?: number };
          }) => {
            const file = files.get(name)!;
            if (options?.preconditionOpts?.ifGenerationMatch === 0 && file.data) {
              throw Object.assign(new Error('Precondition Failed'), { code: 412 });
            }
            file.data = data;
            file.generation = generationCounter++;
            file.metadata = options?.metadata?.metadata ?? {};
          }),
          setMetadata: jest.fn().mockImplementation(async (meta: { metadata?: Record<string, string> }) => {
            const file = files.get(name)!;
            if (!file.data) throw Object.assign(new Error('Not found'), { code: 404 });
            file.metadata = { ...(file.metadata ?? {}), ...(meta?.metadata ?? {}) };
            return [file.metadata];
          }),
          delete: jest.fn().mockImplementation(async () => {
            const file = files.get(name)!;
            if (!file.data) throw Object.assign(new Error('Not found'), { code: 404 });
            file.data = undefined;
          }),
          exists: jest.fn().mockImplementation(async () => {
            const file = files.get(name)!;
            return [!!file.data];
          }),
          download: jest.fn().mockImplementation(async () => {
            const file = files.get(name)!;
            if (!file.data) throw Object.assign(new Error('Not found'), { code: 404 });
            return [file.data];
          }),
          getMetadata: jest.fn().mockImplementation(async () => {
            const file = files.get(name)!;
            if (!file.data) {
              const error = Object.assign(new Error('Not found'), { code: 404 });
              throw error;
            }
            return [{
              size: String(file.data.length),
              generation: String(file.generation),
              metadata: file.metadata ?? {},
            }];
          }),
        } as unknown as FakeFile);
      }
      return files.get(name)! as unknown as File;
    },
  } as unknown as Bucket;

  return { bucket, files };
}

const response: AvHistoricalOptionsResponse = {
  endpoint: 'HISTORICAL_OPTIONS',
  message: 'success',
  data: [
    {
      contractID: 'QQQ260116C00490000',
      symbol: 'QQQ',
      expiration: '2026-01-16',
      strike: '490',
      type: AvOptionType.CALL,
      volume: '100',
      open_interest: '1000',
    },
  ],
};

const analysis: SvtOptionsAnalysis = {
  summary: {
    totalContracts: 1,
    totalVolume: 100,
    totalOpenInterest: 1000,
    callContracts: 1,
    putContracts: 0,
    uniqueStrikes: 1,
    avgVolumePerContract: 100,
    avgOpenInterest: 1000,
  },
  expirations: [],
  strikes: [],
};

describe('GcsCorpusAdapter', () => {
  it('serializes, compresses, and stores a versioned envelope', async () => {
    const { bucket } = createFakeBucket();
    const adapter = new GcsCorpusAdapter(bucket);

    const result = await adapter.writeItem('QQQ', '2026-01-02', response, analysis);

    expect(result.gcsPath).toBe('historical-options/v1/QQQ/2026-01-02.json.gz');
    expect(result.alreadyExists).toBe(false);
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.generation).toBe('1');

    const file = bucket.file(adapter.getObjectPath('QQQ', '2026-01-02'));
    expect((file as any).save).toHaveBeenCalledTimes(1);
    const savedBuffer: Buffer = ((file as any).save as jest.Mock).mock.calls[0][0];
    expect(savedBuffer.length).toBeGreaterThan(0);
    // The conditional write must reach save() as preconditionOpts — a
    // top-level ifGenerationMatch is silently dropped by the SDK.
    expect((file as any).save).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({ preconditionOpts: { ifGenerationMatch: 0 } }),
    );
  });

  it('returns alreadyExists when the conditional write hits a stored object', async () => {
    const { bucket } = createFakeBucket();
    const adapter = new GcsCorpusAdapter(bucket);

    const first = await adapter.writeItem('QQQ', '2026-01-02', response, analysis);
    // The fake bucket enforces ifGenerationMatch:0 like real GCS — this save
    // 412s instead of overwriting, so the stored object is never clobbered.
    const second = await adapter.writeItem('QQQ', '2026-01-02', response, analysis);

    expect(second.alreadyExists).toBe(true);
    expect(second.sha256).toBe(first.sha256);
    expect(second.generation).toBe(first.generation);
  });

  it('reports alreadyExists and reads stored metadata on 412', async () => {
    const { bucket } = createFakeBucket();
    const adapter = new GcsCorpusAdapter(bucket);

    const path = adapter.getObjectPath('TQQQ', '2026-01-02');
    const file = bucket.file(path);
    const existingBuffer = Buffer.from('existing');
    (file as any).data = existingBuffer;
    (file as any).generation = 42;
    (file as any).metadata = { sha256: 'existing-sha' };
    (file as any).save.mockRejectedValue({ code: 412, message: 'Precondition Failed' });

    const result = await adapter.writeItem('TQQQ', '2026-01-02', response, analysis);

    expect(result.alreadyExists).toBe(true);
    expect(result.generation).toBe('42');
    expect(result.bytes).toBe(existingBuffer.length);
    expect(result.sha256).toBe('existing-sha');
  });

  it('reads back and validates a stored envelope', async () => {
    const { bucket } = createFakeBucket();
    const adapter = new GcsCorpusAdapter(bucket);

    const writeResult = await adapter.writeItem('QQQ', '2026-01-02', response, analysis);

    const readResult = await adapter.readItem('QQQ', '2026-01-02');

    expect(readResult.status).toBe('FOUND');
    if (readResult.status === 'FOUND') {
      expect(readResult.bytes).toBe(writeResult.bytes);
      expect(readResult.response.data[0].symbol).toBe('QQQ');
      expect(readResult.envelope.checksum.value).toBe(writeResult.sha256);
    }
  });

  it('returns NOT_FOUND for missing objects', async () => {
    const { bucket } = createFakeBucket();
    const adapter = new GcsCorpusAdapter(bucket);

    const result = await adapter.readItem('QQQ', '2026-01-01');

    expect(result.status).toBe('NOT_FOUND');
  });

  it('returns CORRUPT when the checksum does not match', async () => {
    const { bucket } = createFakeBucket();
    const adapter = new GcsCorpusAdapter(bucket);

    await adapter.writeItem('QQQ', '2026-01-02', response, analysis);

    // Tamper with the object by overwriting it with bad data.
    const file = bucket.file(adapter.getObjectPath('QQQ', '2026-01-02'));
    const zlib = require('node:zlib');
    const bad = zlib.gzipSync(Buffer.from('{"version":"v1","schema":"historical-options","symbol":"QQQ","date":"2026-01-02"}'));
    (file as any).save.mockImplementation(async () => {
      (file as any).data = bad;
      (file as any).generation = 2;
    });
    await (file as any).save(bad);

    const result = await adapter.readItem('QQQ', '2026-01-02');

    expect(result.status).toBe('CORRUPT');
  });

  it('reads metadata without downloading the payload', async () => {
    const { bucket } = createFakeBucket();
    const adapter = new GcsCorpusAdapter(bucket);

    const writeResult = await adapter.writeItem('QQQ', '2026-01-02', response, analysis);

    const metadata = await adapter.getMetadata('QQQ', '2026-01-02');

    expect(metadata).toBeDefined();
    expect(metadata!.gcsPath).toBe(adapter.getObjectPath('QQQ', '2026-01-02'));
    expect(metadata!.sha256).toBe(writeResult.sha256);
    expect(metadata!.generation).toBe(writeResult.generation);
    expect(metadata!.bytes).toBe(writeResult.bytes);
    expect(metadata!.symbol).toBe('QQQ');
    expect(metadata!.date).toBe('2026-01-02');
  });

  it('returns undefined for getMetadata on a missing object', async () => {
    const { bucket } = createFakeBucket();
    const adapter = new GcsCorpusAdapter(bucket);

    const metadata = await adapter.getMetadata('QQQ', '2026-01-01');

    expect(metadata).toBeUndefined();
  });

  describe('chain sanity flags (Task #227)', () => {
    const twoSided: AvHistoricalOptionsResponse = {
      ...response,
      data: [...response.data, { type: AvOptionType.PUT }],
    };

    it('stamps the chainFlag on the stored object metadata at write time', async () => {
      const { bucket } = createFakeBucket();
      const adapter = new GcsCorpusAdapter(bucket);

      // The shared fixture is a single CALL contract — calls_only.
      await adapter.writeItem('QQQ', '2026-01-02', response, analysis);

      const file = bucket.file(adapter.getObjectPath('QQQ', '2026-01-02'));
      expect((file as any).metadata.chainFlag).toBe('calls_only');
    });

    it('leaves chainFlag absent for a healthy two-sided chain', async () => {
      const { bucket } = createFakeBucket();
      const adapter = new GcsCorpusAdapter(bucket);

      await adapter.writeItem('QQQ', '2026-01-02', twoSided, analysis);

      const file = bucket.file(adapter.getObjectPath('QQQ', '2026-01-02'));
      expect((file as any).metadata.chainFlag).toBeUndefined();
    });

    it('projects chainFlag + chainFlagConfirmed through listItems', async () => {
      const { bucket } = createFakeBucket();
      const adapter = new GcsCorpusAdapter(bucket);
      await adapter.writeItem('QQQ', '2026-01-02', response, analysis); // calls_only
      await adapter.writeItem('QQQ', '2026-01-05', twoSided, analysis); // healthy
      await adapter.markChainConfirmed('QQQ', '2026-01-02', 'calls_only');

      const refs = await adapter.listItems('QQQ');
      const byDate = new Map(refs.map((r) => [r.date, r]));

      expect(byDate.get('2026-01-02')).toMatchObject({ chainFlag: 'calls_only', chainFlagConfirmed: true });
      expect(byDate.get('2026-01-05')?.chainFlag).toBeUndefined();
    });

    it('markChainConfirmed merges without clobbering existing metadata', async () => {
      const { bucket } = createFakeBucket();
      const adapter = new GcsCorpusAdapter(bucket);
      await adapter.writeItem('QQQ', '2026-01-02', response, analysis, 'confirmed');

      await adapter.markChainConfirmed('QQQ', '2026-01-02', 'calls_only');

      const file = bucket.file(adapter.getObjectPath('QQQ', '2026-01-02'));
      expect((file as any).metadata).toMatchObject({
        chainFlag: 'calls_only',
        chainFlagConfirmed: 'true',
        kind: 'confirmed',
      });
    });

    it('markChainConfirmed on an unstamped object stamps the flag too (manual forceRefetch path)', async () => {
      const { bucket } = createFakeBucket();
      const adapter = new GcsCorpusAdapter(bucket);
      const path = adapter.getObjectPath('QQQ', '2026-03-04');
      const file = bucket.file(path);
      (file as any).data = Buffer.from('existing');
      (file as any).metadata = { sha256: 'old' }; // pre-flagging-code object — no chainFlag

      await adapter.markChainConfirmed('QQQ', '2026-03-04', 'calls_only');

      // chainFlagConfirmed without chainFlag would escape both reconciler
      // buckets — the mark must keep the object thin-chain-visible.
      expect((file as any).metadata).toMatchObject({
        sha256: 'old',
        chainFlag: 'calls_only',
        chainFlagConfirmed: 'true',
      });
    });

    it('setChainFlag stamps a flag on an existing object (backfill path)', async () => {
      const { bucket } = createFakeBucket();
      const adapter = new GcsCorpusAdapter(bucket);
      const path = adapter.getObjectPath('QQQ', '2026-03-04');
      const file = bucket.file(path);
      (file as any).data = Buffer.from('existing');
      (file as any).metadata = { sha256: 'old' };

      await adapter.setChainFlag('QQQ', '2026-03-04', 'calls_only');

      expect((file as any).metadata).toMatchObject({ sha256: 'old', chainFlag: 'calls_only' });
    });
  });
});

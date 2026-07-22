import type { Bucket, File } from '@google-cloud/storage';

import { GcsTimeSeriesAdapter } from '../../../src/v2/historical-options-corpus/services/gcs-time-series-adapter.service';

interface FakeFile {
  name: string;
  data?: string;
  generation?: number;
  metadata?: Record<string, string>;
  save: jest.Mock;
  exists: jest.Mock;
  download: jest.Mock;
  getMetadata: jest.Mock;
}

function createFakeBucket(): { bucket: Bucket; files: Map<string, FakeFile> } {
  const files = new Map<string, FakeFile>();
  let generationCounter = 1;

  const bucket = {
    file(name: string): File {
      if (!files.has(name)) {
        files.set(name, {
          name,
          data: undefined,
          generation: undefined,
          save: jest.fn().mockImplementation(async (
            data: string,
            options?: { metadata?: { contentType?: string; metadata?: Record<string, string> } },
          ) => {
            const file = files.get(name)!;
            file.data = data;
            file.generation = generationCounter++;
            file.metadata = options?.metadata?.metadata ?? {};
          }),
          exists: jest.fn().mockImplementation(async () => {
            const file = files.get(name)!;
            return [!!file.data];
          }),
          download: jest.fn().mockImplementation(async () => {
            const file = files.get(name)!;
            if (!file.data) {
              throw Object.assign(new Error('Not found'), { code: 404 });
            }
            return [Buffer.from(file.data, 'utf8')];
          }),
          getMetadata: jest.fn().mockImplementation(async () => {
            const file = files.get(name)!;
            if (!file.data) {
              throw Object.assign(new Error('Not found'), { code: 404 });
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

describe('GcsTimeSeriesAdapter', () => {
  it('returns the correct object path with uppercase symbol and contractID', () => {
    const { bucket } = createFakeBucket();
    const adapter = new GcsTimeSeriesAdapter(bucket);

    const path = adapter.getObjectPath('qqq', 'qqq260116c00490000');

    expect(path).toBe('time-series/v1/QQQ/QQQ260116C00490000.jsonl');
  });

  it('returns undefined for missing files', async () => {
    const { bucket } = createFakeBucket();
    const adapter = new GcsTimeSeriesAdapter(bucket);

    const lines = await adapter.readLines('QQQ', 'QQQ260116C00490000');

    expect(lines).toBeUndefined();
  });

  it('writes a jsonl file and returns metadata', async () => {
    const { bucket } = createFakeBucket();
    const adapter = new GcsTimeSeriesAdapter(bucket);

    const result = await adapter.writeLines('QQQ', 'QQQ260116C00490000', [
      '{"d":"2026-01-02","l":"1.0"}',
      '{"d":"2026-01-03","l":"1.1"}',
    ]);

    expect(result.gcsPath).toBe('time-series/v1/QQQ/QQQ260116C00490000.jsonl');
    expect(result.generation).toBe('1');
    expect(result.bytes).toBeGreaterThan(0);
  });

  it('overwrites an existing jsonl file', async () => {
    const { bucket } = createFakeBucket();
    const adapter = new GcsTimeSeriesAdapter(bucket);

    await adapter.writeLines('QQQ', 'QQQ260116C00490000', ['{"d":"2026-01-02","l":"1.0"}']);
    const result = await adapter.writeLines('QQQ', 'QQQ260116C00490000', ['{"d":"2026-01-02","l":"2.0"}']);

    expect(result.generation).toBe('2');

    const lines = await adapter.readLines('QQQ', 'QQQ260116C00490000');
    expect(lines).toEqual(['{"d":"2026-01-02","l":"2.0"}']);
  });

  it('reads back stored lines', async () => {
    const { bucket } = createFakeBucket();
    const adapter = new GcsTimeSeriesAdapter(bucket);

    await adapter.writeLines('QQQ', 'QQQ260116C00490000', [
      '{"d":"2026-01-02","l":"1.0"}',
      '{"d":"2026-01-03","l":"1.1"}',
    ]);

    const lines = await adapter.readLines('QQQ', 'QQQ260116C00490000');

    expect(lines).toEqual([
      '{"d":"2026-01-02","l":"1.0"}',
      '{"d":"2026-01-03","l":"1.1"}',
    ]);
  });
});

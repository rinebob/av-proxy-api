import { CorpusDatesService, type CorpusDatesBucket } from '../../../src/v2/historical-options-corpus/services/corpus-dates.service';

// ---- Fake GCS bucket ----

interface FakePage {
  files: Array<{ name: string }>;
  nextPageToken?: string;
}

function fakeBucket(pages: FakePage[]): { calls: Array<{ prefix: string; pageToken?: string }>; bucket: CorpusDatesBucket } {
  const calls: Array<{ prefix: string; pageToken?: string }> = [];
  const bucket: CorpusDatesBucket = {
    getFiles: async (opts) => {
      calls.push(opts);
      const page = pages[calls.length - 1];
      if (!page) throw new Error(`getFiles called ${calls.length} times but only ${pages.length} page(s) faked`);
      return [page.files, {}, page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}];
    },
  };
  return { calls, bucket };
}

// ---- Tests ----

describe('CorpusDatesService', () => {
  it('lists .json.gz objects under the symbol prefix as sorted dates', async () => {
    const { bucket, calls } = fakeBucket([
      {
        files: [
          { name: 'historical-options/v1/QQQ/2026-01-06.json.gz' },
          { name: 'historical-options/v1/QQQ/2026-01-05.json.gz' },
          { name: 'historical-options/v1/QQQ/readme.txt' },
          { name: 'historical-options/v1/QQQ/notes.json.gz' },
          { name: 'historical-options/v1/QQQ/2026-13-40.json.gz' },
          { name: 'historical-options/v1/QQQ/nested/ignored.json.gz' },
        ],
      },
    ]);
    const svc = new CorpusDatesService(bucket);
    const dates = await svc.listCorpusDates('qqq');
    expect(calls[0].prefix).toBe('historical-options/v1/QQQ/');
    expect(dates).toEqual(['2026-01-05', '2026-01-06']);
  });

  it('paginates until nextPageToken is exhausted', async () => {
    const { bucket, calls } = fakeBucket([
      { files: [{ name: 'historical-options/v1/QQQ/2026-01-05.json.gz' }], nextPageToken: 'p2' },
      { files: [{ name: 'historical-options/v1/QQQ/2026-01-06.json.gz' }] },
    ]);
    const svc = new CorpusDatesService(bucket);
    const dates = await svc.listCorpusDates('QQQ');
    expect(calls).toHaveLength(2);
    expect(calls[1].pageToken).toBe('p2');
    expect(dates).toEqual(['2026-01-05', '2026-01-06']);
  });

  it('dedupes dates repeated across pages', async () => {
    const { bucket } = fakeBucket([
      {
        files: [{ name: 'historical-options/v1/QQQ/2026-01-05.json.gz' }],
        nextPageToken: 'p2',
      },
      { files: [{ name: 'historical-options/v1/QQQ/2026-01-05.json.gz' }] },
    ]);
    const svc = new CorpusDatesService(bucket);
    expect(await svc.listCorpusDates('QQQ')).toEqual(['2026-01-05']);
  });

  it('stops when the API echoes the same pageToken', async () => {
    const { bucket, calls } = fakeBucket([
      {
        files: [{ name: 'historical-options/v1/QQQ/2026-01-05.json.gz' }],
        nextPageToken: 'p2',
      },
      {
        files: [{ name: 'historical-options/v1/QQQ/2026-01-06.json.gz' }],
        nextPageToken: 'p2', // same token — must not loop forever
      },
    ]);
    const svc = new CorpusDatesService(bucket);
    const dates = await svc.listCorpusDates('QQQ');
    expect(calls).toHaveLength(2);
    expect(dates).toEqual(['2026-01-05', '2026-01-06']);
  });

  it('returns empty list when no corpus objects exist', async () => {
    const { bucket } = fakeBucket([{ files: [] }]);
    const svc = new CorpusDatesService(bucket);
    expect(await svc.listCorpusDates('QQQ')).toEqual([]);
  });
});

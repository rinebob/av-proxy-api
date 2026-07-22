import type { Firestore } from 'firebase-admin/firestore';

import { CorpusMetadataService } from '../../../src/v2/historical-options-corpus/services/corpus-metadata.service';
import type { CorpusRunPlan } from '../../../src/v2/historical-options-corpus/services/corpus-metadata.service';

function isIncrementValue(value: any): boolean {
  return typeof value === 'object' && value !== null && 'operand' in value && typeof value.operand === 'number';
}

function createFakeFirestore(): Firestore {
  const docs = new Map<string, any>();

  const createDocRef = (path: string) => ({
    path,
    collection: (id: string) => createCollectionRef(`${path}/${id}`),
    get: jest.fn().mockImplementation(async () => {
      const data = docs.get(path);
      return { exists: data !== undefined, data: () => data };
    }),
    set: jest.fn().mockImplementation(async (data: any) => {
      docs.set(path, { ...(docs.get(path) ?? {}), ...data });
    }),
    update: jest.fn().mockImplementation(async (data: any) => {
      const existing = docs.get(path) ?? {};
      const merged: Record<string, any> = { ...existing };
      for (const [key, value] of Object.entries(data) as Array<[string, any]>) {
        if (isIncrementValue(value)) {
          merged[key] = (Number(merged[key]) || 0) + value.operand;
        } else {
          merged[key] = value;
        }
      }
      docs.set(path, merged);
    }),
  });

  const createCollectionRef = (path: string) => ({
    doc: (id: string) => createDocRef(`${path}/${id}`),
  });

  const batch = {
    set: jest.fn().mockImplementation((ref: any, data: any) => {
      docs.set(ref.path, { ...(docs.get(ref.path) ?? {}), ...data });
    }),
    commit: jest.fn().mockResolvedValue(undefined),
  };

  return {
    collection: (id: string) => createCollectionRef(id),
    batch: jest.fn().mockReturnValue(batch),
  } as unknown as Firestore;
}

describe('CorpusMetadataService', () => {
  it('creates a run plan and writes pending item docs', async () => {
    const firestore = createFakeFirestore();
    const service = new CorpusMetadataService(firestore);

    const plan: CorpusRunPlan = {
      runId: 'test-run',
      symbols: ['QQQ', 'TQQQ'],
      startDate: '2026-01-01',
      endDate: '2026-01-10',
      totalItems: 2,
      items: [
        { symbol: 'QQQ', date: '2026-01-02' },
        { symbol: 'TQQQ', date: '2026-01-03' },
      ],
      dryRun: true,
      pilot: true,
    };

    await service.createRunPlan(plan);

    const runDoc = await service.getRunDoc('test-run');
    expect(runDoc).toBeDefined();
    expect(runDoc?.totalItems).toBe(2);
    expect(runDoc?.status).toBe('planned');

    const qqq = await service.getItemDoc('test-run', 'QQQ_2026-01-02');
    expect(qqq?.status).toBe('pending');
    expect(qqq?.symbol).toBe('QQQ');
  });

  it('records a successful item and increments the run counter', async () => {
    const firestore = createFakeFirestore();
    const service = new CorpusMetadataService(firestore);

    await service.createRunPlan({
      runId: 'run-2',
      symbols: ['QQQ'],
      startDate: '2026-01-01',
      endDate: '2026-01-10',
      totalItems: 1,
      items: [{ symbol: 'QQQ', date: '2026-01-02' }],
      dryRun: false,
      pilot: false,
    });

    await service.setItemSuccess('run-2', 'QQQ_2026-01-02', {
      gcsPath: 'gs://bucket/historical-options/v1/QQQ/2026-01-02.json.gz',
      sha256: 'abc',
      bytes: 123,
      apiCalls: 1,
    });

    await service.incrementCompleted('run-2', 1);

    const item = await service.getItemDoc('run-2', 'QQQ_2026-01-02');
    expect(item?.status).toBe('success');
    expect(item?.sha256).toBe('abc');

    const run = await service.getRunDoc('run-2');
    expect(run?.completedItems).toBe(1);
    expect(run?.apiCalls).toBe(1);
  });

  it('records a failed item and increments the failed counter', async () => {
    const firestore = createFakeFirestore();
    const service = new CorpusMetadataService(firestore);

    await service.createRunPlan({
      runId: 'run-3',
      symbols: ['QQQ'],
      startDate: '2026-01-01',
      endDate: '2026-01-10',
      totalItems: 1,
      items: [{ symbol: 'QQQ', date: '2026-01-02' }],
      dryRun: false,
      pilot: false,
    });

    await service.setItemFailure('run-3', 'QQQ_2026-01-02', 'upstream error');
    await service.incrementFailed('run-3');

    const run = await service.getRunDoc('run-3');
    expect(run?.failedItems).toBe(1);
  });
});

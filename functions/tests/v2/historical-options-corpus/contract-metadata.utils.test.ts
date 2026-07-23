import type { Bucket } from '@google-cloud/storage';

import { resolveContractMetadata } from '../../../src/v2/historical-options-corpus/services/contract-metadata.utils';

function createBucket(metadataResult?: { metadata: Record<string, unknown> }): any {
  return {
    file: jest.fn().mockReturnValue({
      getMetadata: jest.fn().mockResolvedValue(metadataResult ? [metadataResult] : [{}]),
    }),
  };
}

describe('resolveContractMetadata', () => {
  it('parses a valid OCC-style contractID', async () => {
    const result = await resolveContractMetadata('QQQ', 'QQQ240719C00450000', createBucket());
    expect(result).toEqual({ expiration: '2024-07-19', type: 'call', strike: '450' });
  });

  it('returns null when the symbol prefix does not match', async () => {
    const result = await resolveContractMetadata('AAPL', 'QQQ240719C00450000', createBucket());
    expect(result).toBeNull();
  });

  it('falls back to GCS custom metadata when the contractID cannot be parsed', async () => {
    const bucket = createBucket({ metadata: { expiration: '2024-07-19', type: 'put', strike: '125.5' } });
    const result = await resolveContractMetadata('QQQ', 'QQQUNKNOWNCONTRACT', bucket as unknown as Bucket);
    expect(result).toEqual({ expiration: '2024-07-19', type: 'put', strike: '125.5' });
    expect(bucket.file).toHaveBeenCalledWith('time-series/v1/QQQ/QQQUNKNOWNCONTRACT.jsonl');
  });

  it('returns null when contractID cannot be parsed and GCS metadata is missing', async () => {
    const bucket = createBucket({ metadata: {} });
    const result = await resolveContractMetadata('QQQ', 'QQQUNKNOWNCONTRACT', bucket as unknown as Bucket);
    expect(result).toBeNull();
  });

  it('returns null when GCS metadata has an invalid option type', async () => {
    const bucket = createBucket({ metadata: { expiration: '2024-07-19', type: 'foo', strike: '450' } });
    const result = await resolveContractMetadata('QQQ', 'QQQUNKNOWNCONTRACT', bucket as unknown as Bucket);
    expect(result).toBeNull();
  });

  it('returns null when GCS metadata cannot be fetched', async () => {
    const bucket = {
      file: jest.fn().mockReturnValue({
        getMetadata: jest.fn().mockRejectedValue(new Error('not found')),
      }),
    };
    const result = await resolveContractMetadata('QQQ', 'QQQUNKNOWNCONTRACT', bucket as unknown as Bucket);
    expect(result).toBeNull();
  });

  it('returns null for a contractID with an invalid date', async () => {
    const result = await resolveContractMetadata('QQQ', 'QQQ240231C00450000', createBucket());
    expect(result).toBeNull();
  });

  it('returns null for a contractID with an invalid type code', async () => {
    const result = await resolveContractMetadata('QQQ', 'QQQ240719X00450000', createBucket());
    expect(result).toBeNull();
  });
});

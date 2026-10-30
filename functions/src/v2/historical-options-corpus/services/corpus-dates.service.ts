import { isValidIsoDate } from '../../common/utils/date-time.utils';
import { HISTORICAL_OPTIONS_CORPUS_PREFIX } from '../types';

const PAGE_SIZE = 1000;

/**
 * Minimal structural contract for the GCS bucket surface this service
 * needs — the real `Bucket` from firebase-admin/storage satisfies it, and
 * tests inject a fake.
 */
export interface CorpusDatesBucket {
  getFiles(options: {
    prefix: string;
    maxResults: number;
    pageToken?: string;
  }): Promise<[Array<{ name: string }>, unknown, unknown]>;
}

interface GcsListResponse {
  nextPageToken?: string;
}

/**
 * Lists the trading dates for which a corpus object exists under
 * `historical-options/v1/{symbol}/`. Returns `YYYY-MM-DD` strings sorted
 * ascending — dates only, no file metadata on the wire.
 */
export class CorpusDatesService {
  constructor(private readonly bucket: CorpusDatesBucket) {}

  async listCorpusDates(symbol: string): Promise<string[]> {
    const prefix = `${HISTORICAL_OPTIONS_CORPUS_PREFIX}/${symbol.toUpperCase()}/`;
    const dates = new Set<string>();
    let pageToken: string | undefined;

    for (;;) {
      const [files, , apiResponse] = await this.bucket.getFiles({
        prefix,
        maxResults: PAGE_SIZE,
        pageToken,
      });

      for (const file of files) {
        const relativePath = file.name.slice(prefix.length);
        if (!relativePath.endsWith('.json.gz') || relativePath.includes('/')) continue;
        const date = relativePath.replace(/\.json\.gz$/, '');
        if (isValidIsoDate(date)) dates.add(date);
      }

      const nextPageToken = (apiResponse as GcsListResponse | undefined)?.nextPageToken;
      if (!nextPageToken || nextPageToken === pageToken) break;
      pageToken = nextPageToken;
    }

    return [...dates].sort();
  }
}

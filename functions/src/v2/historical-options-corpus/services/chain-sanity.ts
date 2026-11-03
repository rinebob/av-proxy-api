/**
 * chainSanityCounts — chain-sanity derivation for the options corpus
 * (Task #227, PRD story 10c).
 *
 * A stored chain that is empty or contains contracts of only one side is
 * suspect — malformed upstream snapshots (e.g. the verified QQQ calls-only
 * dates) would otherwise count as healthy coverage forever. The flag is
 * recorded on the seed run item and stamped on the GCS object so the
 * coverage reconciler can treat suspect chains as gap-eligible for re-seed.
 */
import { AvOptionType, type AvHistoricalOptionsResponse } from '@shared/alpha-vantage';

import type { CorpusChainFlag } from '../types';

export interface ChainSanity {
  putCount: number;
  callCount: number;
  rowCount: number;
  /** Absent for a healthy two-sided chain. */
  flag?: CorpusChainFlag;
}

export function chainSanityCounts(response: AvHistoricalOptionsResponse): ChainSanity {
  let putCount = 0;
  let callCount = 0;
  const rows = response.data ?? [];
  for (const row of rows) {
    if (row.type === AvOptionType.PUT) putCount += 1;
    else if (row.type === AvOptionType.CALL) callCount += 1;
  }

  const flag: CorpusChainFlag | undefined =
    putCount === 0 && callCount === 0
      ? 'empty'
      : putCount === 0
        ? 'calls_only'
        : callCount === 0
          ? 'puts_only'
          : undefined;

  return { putCount, callCount, rowCount: rows.length, flag };
}

/**
 * Ingestion-time defaults for the options-corpus flags (Thread #105 §76):
 * every tracked symbol carries `optionsEnabled=false` and an empty
 * `optionsEnabledHistory` until curated. Applied when the payload doesn't
 * supply a flag AND the existing doc doesn't either — a caller's explicit
 * `optionsEnabled` (enable at ingestion) and an existing doc's curated value
 * are both preserved.
 */
import type { TrackedSymbolV2 } from '@shared/alpha-vantage';

type FlagFields = Pick<TrackedSymbolV2, 'optionsEnabled' | 'optionsEnabledHistory'>;

export function withOptionsFlagDefaults<T extends FlagFields>(
  doc: T,
  existing: Partial<TrackedSymbolV2> | undefined,
): T {
  // The two fields default independently — an enable-at-ingestion payload
  // keeps its optionsEnabled=true but still gets the empty audit array.
  const out = { ...doc };
  if (
    (doc.optionsEnabled === undefined || doc.optionsEnabled === null) &&
    (existing?.optionsEnabled === undefined || existing?.optionsEnabled === null)
  ) {
    out.optionsEnabled = false;
  }
  if (
    (doc.optionsEnabledHistory === undefined || doc.optionsEnabledHistory === null) &&
    (existing?.optionsEnabledHistory === undefined || existing?.optionsEnabledHistory === null)
  ) {
    out.optionsEnabledHistory = [];
  }
  return out;
}

/**
 * Ingestion-time defaults for the options-corpus flags (Thread #105 §76):
 * every tracked symbol carries `optionsEnabled=false` and an empty
 * `optionsEnabledHistory` until curated. Applied when the payload doesn't
 * supply a flag AND the existing doc doesn't either — an explicit flag in
 * the payload (tests only; `saveTrackedSymbol` strips client-supplied
 * flags — `setOptionsEnabledV2` is the only governed toggle path) and an
 * existing doc's curated value are both preserved.
 */
import type { TrackedSymbolV2 } from '@shared/alpha-vantage';

type FlagFields = Partial<Pick<TrackedSymbolV2, 'optionsEnabled' | 'optionsEnabledHistory'>>;
type ClientManagedFlagFields = Pick<TrackedSymbolV2,
  'optionable' | 'optionableCheckedAt' | 'optionableProbeSummary' | 'optionableProbeError' |
  'optionsEnabled' | 'optionsEnabledHistory'
>;

export function stripClientManagedFlagFields<T extends Partial<TrackedSymbolV2>>(
  doc: T,
): Omit<T, keyof ClientManagedFlagFields> {
  const {
    optionable: _optionable,
    optionableCheckedAt: _optionableCheckedAt,
    optionableProbeSummary: _optionableProbeSummary,
    optionableProbeError: _optionableProbeError,
    optionsEnabled: _optionsEnabled,
    optionsEnabledHistory: _optionsEnabledHistory,
    ...safe
  } = doc;
  return safe;
}

export function withOptionsFlagDefaults<T extends FlagFields>(
  doc: T,
  existing: Partial<TrackedSymbolV2> | undefined,
): T & FlagFields {
  // The two fields default independently — an enable-at-ingestion payload
  // keeps its optionsEnabled=true but still gets the empty audit array.
  const out = { ...doc } as T & FlagFields;
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

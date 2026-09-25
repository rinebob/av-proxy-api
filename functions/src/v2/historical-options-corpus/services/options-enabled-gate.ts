import { db } from '../../../firebase-admin-init';
import { FirestoreCollection } from '@shared/firestore';
import { TRACKED_SYMBOL_V2_FIELDS } from '@shared/alpha-vantage';

/**
 * Read-side dep for the checker: returns the tracked-symbol doc data or
 * undefined when the doc does not exist. Injected for testability.
 */
export type TrackedSymbolDocReader = (symbol: string) => Promise<Record<string, unknown> | undefined>;

const defaultReader: TrackedSymbolDocReader = async (symbol) => {
  const doc = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).doc(symbol).get();
  return doc.exists ? doc.data() : undefined;
};

/**
 * Returns a checker that reports true only when the symbol's tracked-symbol
 * doc exists and carries `optionsEnabled === true` (Task #150). Every corpus
 * ingestion entry point gates on this so vendor spend stays bounded to the
 * curated enabled set — a missing doc or false flag drops the work.
 */
export function createOptionsEnabledChecker(
  readDoc: TrackedSymbolDocReader = defaultReader,
): (symbol: string) => Promise<boolean> {
  return async (symbol) => {
    const data = await readDoc(symbol.toUpperCase());
    return data?.[TRACKED_SYMBOL_V2_FIELDS.OPTIONS_ENABLED] === true;
  };
}

export type EnabledSymbolLister = () => Promise<string[]>;

/**
 * Lists all options-enabled symbols — the live universe for corpus pipelines
 * (Task #150). Replaces the old hardcoded QQQ/TQQQ pilot lists.
 */
export const listOptionsEnabledSymbols: EnabledSymbolLister = async () => {
  const snap = await db
    .collection(FirestoreCollection.TRACKED_SYMBOLS)
    .where(TRACKED_SYMBOL_V2_FIELDS.OPTIONS_ENABLED, '==', true)
    .get();
  return snap.docs.map((d) => d.id);
};

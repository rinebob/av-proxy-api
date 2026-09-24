/**
 * Client-side sorting for the Symbol Manager V2 table.
 *
 * The FE loads the full tracked-symbol set (limit=10000) and paginates by
 * slicing, so sorting must run on the loaded array BEFORE the page slice —
 * never triggers a refetch.
 *
 * Rules: case-insensitive string compare; numeric for numbers and timestamp
 * fields; missing values (undefined/null/empty/non-finite) always sort last
 * regardless of direction; ties break on `symbol` ascending.
 */
import type { TrackedSymbolV2 } from '@shared/alpha-vantage';

export type SortDirection = 'asc' | 'desc' | '';
export interface SortLevel { field: string; direction: 'asc' | 'desc'; }

function toMillis(v: unknown): number | undefined {
  if (v == null) return undefined;
  if (v instanceof Date) return v.getTime();
  const seconds = (v as { seconds?: number }).seconds;
  if (typeof seconds === 'number') return seconds * 1000;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return undefined;
}

/** Column id → value accessor. Unknown ids fall back to `symbol`. */
const SORT_ACCESSORS: Record<string, (s: TrackedSymbolV2) => unknown> = {
  symbol: s => s.symbol,
  name: s => s.name,
  type: s => s.type,
  sector: s => s.companyInfo?.Sector,
  industry: s => s.companyInfo?.Industry,
  marketCap: s => s.companyInfo?.marketCap,
  beta: s => s.companyInfo?.beta,
  _createdAt: s => toMillis(s._createdAt),
  _lastUpdated: s => toMillis(s._lastUpdated),
  _isActive: s => (s._isActive === undefined ? undefined : s._isActive ? 1 : 0),
  optionable: s => (s.optionable === undefined || s.optionable === null ? undefined : s.optionable ? 1 : 0),
  optionsEnabled: s => (s.optionsEnabled === undefined ? undefined : s.optionsEnabled ? 1 : 0),
};

function isMissing(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (typeof v === 'number' && !Number.isFinite(v));
}

function bySymbol(a: TrackedSymbolV2, b: TrackedSymbolV2): number {
  return (a.symbol ?? '').localeCompare(b.symbol ?? '');
}

function compareLevel(a: TrackedSymbolV2, b: TrackedSymbolV2, level: SortLevel): number {
  const access = SORT_ACCESSORS[level.field] ?? SORT_ACCESSORS['symbol'];
  const va = access(a);
  const vb = access(b);
  const aMissing = isMissing(va);
  const bMissing = isMissing(vb);
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;   // missing always last, both directions
  if (bMissing) return -1;
  const cmp =
    typeof va === 'number' && typeof vb === 'number'
      ? va - vb
      : String(va).localeCompare(String(vb), undefined, { sensitivity: 'base' });
  return level.direction === 'desc' ? -cmp : cmp;
}

/** Returns a new sorted array; the input is not mutated. */
export function sortTrackedSymbols(
  list: readonly TrackedSymbolV2[],
  field: string,
  direction: SortDirection
): TrackedSymbolV2[] {
  const levels: SortLevel[] =
    direction === '' ? [] : [{ field, direction: direction as 'asc' | 'desc' }];
  return sortTrackedSymbolsMulti(list, levels.length ? levels : [{ field: 'symbol', direction: 'asc' }]);
}

/**
 * Multi-level sort: levels are applied primary → secondary → …, with `symbol`
 * ascending as the final tiebreak. Empty levels → symbol order.
 */
export function sortTrackedSymbolsMulti(
  list: readonly TrackedSymbolV2[],
  levels: readonly SortLevel[]
): TrackedSymbolV2[] {
  return [...list].sort((a, b) => {
    for (const level of levels) {
      const cmp = compareLevel(a, b, level);
      if (cmp !== 0) return cmp;
    }
    return bySymbol(a, b);
  });
}

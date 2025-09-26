import type { RefreshRequestLog } from '@shared/health-metrics';
import { RefreshStatus } from '@shared/firestore';

/* Coerce Firestore Timestamp | Date | number | string to epoch ms safely */
export function getTimeMs(val: unknown): number {
  if (!val) return 0;
  try {
    // Firestore Timestamp has toDate()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v: any = val as any;
    if (typeof v?.toDate === 'function') return v.toDate().getTime();
    if (val instanceof Date) return (val as Date).getTime();
    const d = new Date(val as any);
    const t = d.getTime();
    return isNaN(t) ? 0 : t;
  } catch {
    return 0;
  }
}

/** Rank for status comparison using enum values: SUCCESS (1), PENDING/OTHER (2), FAILURE (3) */
export function statusRank(status?: RefreshStatus | string): number {
  if (status === RefreshStatus.SUCCESS) return 1;
  if (status === RefreshStatus.FAILURE) return 3;
  return 2;
}

export function groupByEndpoint(items: RefreshRequestLog[]): Map<string, RefreshRequestLog[]> {
  const map = new Map<string, RefreshRequestLog[]>();
  for (const it of items) {
    const key = it.endpointId || 'unknown';
    const arr = map.get(key);
    if (arr) arr.push(it);
    else map.set(key, [it]);
  }
  return map;
}

export function computeLatest(events: RefreshRequestLog[]): RefreshRequestLog | undefined {
  if (!events?.length) return undefined;
  return events.reduce((acc, ev) => (getTimeMs(ev.timestamp) > getTimeMs(acc.timestamp) ? ev : acc));
}

// UI sorting support ---------------------------------------------------------
/** Comparator helpers with unified value type */
type FieldValue = string | number;
const cmpNumber: (a: FieldValue, b: FieldValue) => number = (a, b) => Number(a) - Number(b);
const cmpString: (a: FieldValue, b: FieldValue) => number = (a, b) => String(a).localeCompare(String(b));

/**
 * Declare sortable keys as a typed subset of RefreshRequestLog keys.
 * This keeps keys source-of-truth tied to the interface without magic strings elsewhere.
 */
export const SORTABLE_KEYS = [
  'timestamp',
  'symbol',
  'status',
  'durationMs',
  'responseSize',
] as const satisfies ReadonlyArray<Extract<keyof RefreshRequestLog, string>>;

export type SortField = typeof SORTABLE_KEYS[number];

/**
 * Programmatically build a constant object of keys for template/component use,
 * ensuring values always match SortField and stay in sync with SORTABLE_KEYS.
 */
export const SortKeys = Object.freeze(
  SORTABLE_KEYS.reduce((acc, k) => {
    (acc as Record<string, SortField>)[k] = k;
    return acc;
  }, {} as Record<SortField, SortField>)
);

/** Descriptor type for field selectors and comparators */
interface FieldDescriptor<T extends FieldValue> {
  select: (e: RefreshRequestLog) => T;
  compare: (a: FieldValue, b: FieldValue) => number;
}

/**
 * Strongly-typed descriptor map for sortable fields. Keys are derived from RefreshRequestLog.
 */
export const EVENT_FIELDS = {
  timestamp: {
    select: (e: RefreshRequestLog) => getTimeMs(e.timestamp),
    compare: cmpNumber,
  },
  symbol: {
    select: (e: RefreshRequestLog) => (e.symbol || '').toUpperCase(),
    compare: cmpString,
  },
  status: {
    select: (e: RefreshRequestLog) => statusRank(e.status as unknown as RefreshStatus),
    compare: cmpNumber,
  },
  durationMs: {
    select: (e: RefreshRequestLog) => (typeof e.durationMs === 'number' ? e.durationMs : 0),
    compare: cmpNumber,
  },
  responseSize: {
    select: (e: RefreshRequestLog) => (typeof e.responseSize === 'number' ? e.responseSize : 0),
    compare: cmpNumber,
  },
} satisfies Record<SortField, FieldDescriptor<FieldValue>>;

/**
 * Builds a stable comparator for RefreshRequestLog arrays based on UI sort field and direction.
 * Stability: falls back to baseIndex (order from latest-first baseline) to avoid jitter.
 */
export function buildEventComparator(
  active: SortField | null,
  dir: 'asc' | 'desc',
  baseIndex: Map<RefreshRequestLog, number>
): (a: RefreshRequestLog, b: RefreshRequestLog) => number {
  const factor = dir === 'asc' ? 1 : -1;
  const key: SortField = (active ?? 'timestamp') as SortField;
  const { select, compare } = EVENT_FIELDS[key];

  return (a: RefreshRequestLog, b: RefreshRequestLog): number => {
    const va = select(a);
    const vb = select(b);

    const primary = compare(va, vb);
    if (primary !== 0) return factor * primary;

    // Stable fallback to base order
    const ia = baseIndex.get(a) ?? 0;
    const ib = baseIndex.get(b) ?? 0;
    return factor * (ia - ib);
  };
}

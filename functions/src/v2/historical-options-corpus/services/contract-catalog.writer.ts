import type { Firestore } from 'firebase-admin/firestore';

import {
  OPTIONS_FILE_INDEX_COLLECTION,
  TS_CONTRACTS_SUBCOLLECTION,
  classifyContractLength,
  calendarDaysBetween,
  dayOfWeek,
  type ContractCatalogDoc,
  type LatestSnapshot,
} from '@shared/options';

import type { TimeSeriesStorageRecord } from './time-series-contract.utils';
import { parseContractIDMetadata } from './contract-metadata.utils';
import { TradingCalendarService } from './trading-calendar.service';

export type CatalogLogger = (message: string, meta?: Record<string, unknown>) => void;

/**
 * Input for writing a single `ts-contracts` doc.
 * Combines contract identity (parsed from the contract ID) with
 * observation metadata (from the builder's sorted record array).
 */
export interface ContractCatalogInput {
  /** Ticker symbol (e.g. "QQQ"). */
  symbol: string;
  /** OCC-format contract ID (e.g. "QQQ260116C00450000"). */
  contractId: string;
  /** First observed date (ISO, from GCS metadata or sorted[0].d). */
  firstObserved: string;
  /** Last observed date (ISO, from GCS metadata or sorted[last].d). */
  lastObserved: string;
  /** Total observation count. */
  observationCount: number;
  /** Most recent storage record, used to populate `latest`. */
  latestRecord?: TimeSeriesStorageRecord;
}

/**
 * Firestore writer for the `ts-contracts` subcollection.
 *
 * Single concern: writing per-contract catalog metadata docs.
 * Called by the time-series builder after each GCS file flush and
 * by the one-time backfill script.
 *
 * GCS is the source of truth. This catalog is a derived cache.
 */
export class ContractCatalogWriter {
  private readonly log: CatalogLogger;
  private readonly calendar: TradingCalendarService;

  constructor(
    private readonly db: Firestore,
    logger?: CatalogLogger,
  ) {
    this.log = logger ?? ((msg: string) => console.log(msg));
    this.calendar = new TradingCalendarService();
  }

  /**
   * Writes (or overwrites) a single `ts-contracts/{contractId}` doc.
   *
   * Computes `contractLengthDays`, `contractLengthBucket`, and
   * `expectedObservationCount` from the provided inputs.  The `latest`
   * snapshot is populated when `latestRecord` is supplied and contains
   * the relevant fields.
   *
   * # Reason: The builder calls this after a successful GCS write, so the
   * catalog never references data that doesn't exist in GCS.
   */
  async upsertContractCatalog(input: ContractCatalogInput): Promise<void> {
    const parsed = parseContractIDMetadata(input.symbol, input.contractId);
    if (!parsed) {
      this.log('catalog.upsert.skip', { contractId: input.contractId, reason: 'unparseable' });
      return;
    }

    const upperSymbol = input.symbol.toUpperCase();
    const contractIdUpper = input.contractId.toUpperCase();

    const contractLengthDays = calendarDaysBetween(input.firstObserved, parsed.expiration);
    const contractLengthBucket = contractLengthDays !== null
      ? classifyContractLength(contractLengthDays)
      : '—';

    const expectedObservationCount = input.firstObserved
      ? this.calendar.getTradingDates(input.firstObserved, parsed.expiration).length
      : 0;

    const latest = input.latestRecord
      ? extractLatestSnapshot(input.latestRecord)
      : undefined;

    const latestDelta = input.latestRecord?.de ? Number(input.latestRecord.de) : undefined;
    const latestIv = input.latestRecord?.iv ? Number(input.latestRecord.iv) : undefined;

    const doc: ContractCatalogDoc = {
      contractId: contractIdUpper,
      expiration: parsed.expiration,
      strike: Number(parsed.strike),
      type: parsed.type,
      firstObserved: input.firstObserved,
      firstObservedDow: input.firstObserved ? dayOfWeek(input.firstObserved) : '',
      lastObserved: input.lastObserved,
      lastObservedDow: input.lastObserved ? dayOfWeek(input.lastObserved) : '',
      observationCount: input.observationCount,
      expectedObservationCount,
      contractLengthDays: contractLengthDays ?? 0,
      contractLengthBucket,
      latest,
      latestDelta,
      latestIv,
      lastUpdated: new Date().toISOString(),
    };

    const docRef = this.db
      .collection(OPTIONS_FILE_INDEX_COLLECTION)
      .doc(upperSymbol)
      .collection(TS_CONTRACTS_SUBCOLLECTION)
      .doc(contractIdUpper);

    await docRef.set(doc, { merge: true });

    this.log('catalog.upsert', {
      symbol: upperSymbol,
      contractId: contractIdUpper,
      lengthBucket: contractLengthBucket,
      observations: input.observationCount,
    });
  }
}

/**
 * Extracts the `LatestSnapshot` fields from a storage record.
 *
 * Returns `undefined` when the record has none of the relevant fields.
 * Individual fields are optional in the storage format — only `d` (date)
 * is guaranteed — so we omit any field that is missing or empty.
 */
function extractLatestSnapshot(record: TimeSeriesStorageRecord): LatestSnapshot | undefined {
  const snapshot: LatestSnapshot = {};

  if (record.m) snapshot.mark = record.m;
  if (record.v) snapshot.volume = record.v;
  if (record.oi) snapshot.openInterest = record.oi;
  if (record.iv) snapshot.iv = record.iv;
  if (record.de) snapshot.delta = record.de;
  if (record.g) snapshot.gamma = record.g;
  if (record.t) snapshot.theta = record.t;
  if (record.ve) snapshot.vega = record.ve;
  if (record.r) snapshot.rho = record.r;

  if (Object.keys(snapshot).length === 0) return undefined;

  return snapshot;
}

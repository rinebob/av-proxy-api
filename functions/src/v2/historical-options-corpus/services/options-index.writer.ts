import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';

import { parseContractIDMetadata } from './contract-metadata.utils';

/** Firestore root collection for the options file index. */
export const OPTIONS_FILE_INDEX_COLLECTION = 'options-file-index';

/** Subcollection for per-expiration index docs. */
export const TS_EXPIRATIONS_SUBCOLLECTION = 'ts-expirations';

/** Subcollection for per-strike index docs. */
export const TS_STRIKES_SUBCOLLECTION = 'ts-strikes';

export interface ExpirationIndexDoc {
  date: string;
  strikes: number[];
  types: string[];
  contractIds: string[];
}

export interface StrikeIndexDoc {
  strike: number;
  expirations: string[];
  types: string[];
  contractIds: string[];
}

export interface IndexMetadataDoc {
  symbol: string;
  lastUpdated: string;
  tsExpirationCount: number;
  totalContracts: number;
}

export interface ParsedContract {
  contractId: string;
  expiration: string;
  type: string;
  strike: number;
}

/** Payload for a single Cloud Task that writes a batch of index docs. */
export interface OptionsIndexWritePayload {
  symbol: string;
  phase: 'expirations' | 'strikes' | 'metadata';
  /** Unique ID for this rebuild run, stamped on every doc written. */
  runId?: string;
  /** Expiration docs to write (phase='expirations'). */
  expirationDocs?: ExpirationIndexDoc[];
  /** Strike docs to write (phase='strikes'). */
  strikeDocs?: StrikeIndexDoc[];
  /** Metadata to write (phase='metadata'). */
  metadata?: IndexMetadataDoc;
}

/**
 * Parses a contract ID into the fields needed for indexing.
 * Returns null if the contract ID cannot be parsed.
 */
export function parseContractForIndex(symbol: string, contractId: string): ParsedContract | null {
  const meta = parseContractIDMetadata(symbol, contractId);
  if (!meta) return null;

  const strikeNum = Number(meta.strike);
  if (!Number.isFinite(strikeNum)) return null;

  return {
    contractId: contractId.toUpperCase(),
    expiration: meta.expiration,
    type: meta.type === 'call' ? 'C' : 'P',
    strike: strikeNum,
  };
}

export type IndexLogger = (message: string, meta?: Record<string, unknown>) => void;

/**
 * Firestore writer for the `options-file-index` collection.
 *
 * Single concern: maintaining the derived index that enables fast
 * lookup of time-series contracts by expiration or strike.
 *
 * GCS is the source of truth. This index is a derived cache.
 */
export class OptionsIndexWriter {
  private readonly log: IndexLogger;

  constructor(
    private readonly db: Firestore,
    logger?: IndexLogger,
  ) {
    this.log = logger ?? ((msg: string) => console.log(msg));
  }

  /**
   * Processes a single task payload by writing docs individually.
   * Used by the Cloud Task handler to avoid batch transaction size limits.
   */
  async processWritePayload(payload: OptionsIndexWritePayload): Promise<void> {
    const upperSymbol = payload.symbol.toUpperCase();
    const symbolDocRef = this.db.collection(OPTIONS_FILE_INDEX_COLLECTION).doc(upperSymbol);

    if (payload.phase === 'expirations') {
      const col = symbolDocRef.collection(TS_EXPIRATIONS_SUBCOLLECTION);
      await Promise.all(
        (payload.expirationDocs ?? []).map((doc) =>
          col.doc(doc.date).set({ ...doc, rebuildRunId: payload.runId }),
        ),
      );
      this.log('write.expirations', { symbol: upperSymbol, count: payload.expirationDocs?.length ?? 0, runId: payload.runId });
      return;
    }

    if (payload.phase === 'strikes') {
      const col = symbolDocRef.collection(TS_STRIKES_SUBCOLLECTION);
      await Promise.all(
        (payload.strikeDocs ?? []).map((doc) =>
          col.doc(String(doc.strike)).set({ ...doc, rebuildRunId: payload.runId }),
        ),
      );
      this.log('write.strikes', { symbol: upperSymbol, count: payload.strikeDocs?.length ?? 0, runId: payload.runId });
      return;
    }

    if (payload.phase === 'metadata') {
      if (!payload.metadata) return;
      await symbolDocRef.set({ ...payload.metadata, rebuildRunId: payload.runId });
      this.log('write.metadata', { symbol: upperSymbol, metadata: payload.metadata, runId: payload.runId });
      return;
    }
  }

  /**
   * Groups contracts into task payloads for Cloud Tasks enqueueing.
   * Returns an array of payloads that can each be enqueued as a separate task.
   */
  prepareRebuildPayloads(symbol: string, contractIds: string[]): OptionsIndexWritePayload[] {
    const upperSymbol = symbol.toUpperCase();
    const contracts: ParsedContract[] = [];

    for (const id of contractIds) {
      const parsed = parseContractForIndex(upperSymbol, id);
      if (parsed) {
        contracts.push(parsed);
      }
    }

    const byExpiration = new Map<string, ParsedContract[]>();
    const byStrike = new Map<number, ParsedContract[]>();

    for (const c of contracts) {
      let expList = byExpiration.get(c.expiration);
      if (!expList) {
        expList = [];
        byExpiration.set(c.expiration, expList);
      }
      expList.push(c);

      let strikeList = byStrike.get(c.strike);
      if (!strikeList) {
        strikeList = [];
        byStrike.set(c.strike, strikeList);
      }
      strikeList.push(c);
    }

    const runId = `rebuild-${Date.now()}`;
    const payloads: OptionsIndexWritePayload[] = [];

    // Expiration docs in chunks of 5 — each doc can contain hundreds of contract IDs,
    // so payloads must stay under Cloud Tasks' ~100KB limit.
    const expEntries = Array.from(byExpiration.entries());
    for (let i = 0; i < expEntries.length; i += 5) {
      const chunk = expEntries.slice(i, i + 5);
      const docs = chunk.map(([date, list]) => this.buildExpirationDoc(date, list));
      payloads.push({ symbol: upperSymbol, phase: 'expirations', expirationDocs: docs, runId });
    }

    // Strike docs in chunks of 5
    const strikeEntries = Array.from(byStrike.entries());
    for (let i = 0; i < strikeEntries.length; i += 5) {
      const chunk = strikeEntries.slice(i, i + 5);
      const docs = chunk.map(([strike, list]) => this.buildStrikeDoc(strike, list));
      payloads.push({ symbol: upperSymbol, phase: 'strikes', strikeDocs: docs, runId });
    }

    // Metadata phase
    payloads.push({
      symbol: upperSymbol,
      phase: 'metadata',
      runId,
      metadata: {
        symbol: upperSymbol,
        lastUpdated: new Date().toISOString(),
        tsExpirationCount: byExpiration.size,
        totalContracts: contracts.length,
      },
    });

    this.log('prepare.payloads', {
      symbol: upperSymbol,
      total: contracts.length,
      expirations: byExpiration.size,
      strikes: byStrike.size,
      payloadCount: payloads.length,
      runId,
    });

    return payloads;
  }

  /**
   * Used by the time-series builder after each file write.
   */
  async upsertContract(symbol: string, contractId: string): Promise<void> {
    const parsed = parseContractForIndex(symbol, contractId);
    if (!parsed) return;

    const upperSymbol = symbol.toUpperCase();
    const symbolDocRef = this.db.collection(OPTIONS_FILE_INDEX_COLLECTION).doc(upperSymbol);

    // arrayUnion is idempotent — no need to read-then-check-then-write.
    await Promise.all([
      symbolDocRef
        .collection(TS_EXPIRATIONS_SUBCOLLECTION)
        .doc(parsed.expiration)
        .set({
          strikes: FieldValue.arrayUnion(parsed.strike),
          types: FieldValue.arrayUnion(parsed.type),
          contractIds: FieldValue.arrayUnion(parsed.contractId),
        }, { merge: true }),

      symbolDocRef
        .collection(TS_STRIKES_SUBCOLLECTION)
        .doc(String(parsed.strike))
        .set({
          expirations: FieldValue.arrayUnion(parsed.expiration),
          types: FieldValue.arrayUnion(parsed.type),
          contractIds: FieldValue.arrayUnion(parsed.contractId),
        }, { merge: true }),
    ]);

    // Update metadata doc
    await symbolDocRef.set({
      symbol: upperSymbol,
      lastUpdated: new Date().toISOString(),
    }, { merge: true });
  }

  private buildExpirationDoc(date: string, contracts: ParsedContract[]): ExpirationIndexDoc {
    const strikes = [...new Set(contracts.map((c) => c.strike))].sort((a, b) => a - b);
    const types = [...new Set(contracts.map((c) => c.type))].sort();
    const contractIds = contracts.map((c) => c.contractId).sort();
    return { date, strikes, types, contractIds };
  }

  private buildStrikeDoc(strike: number, contracts: ParsedContract[]): StrikeIndexDoc {
    const expirations = [...new Set(contracts.map((c) => c.expiration))].sort();
    const types = [...new Set(contracts.map((c) => c.type))].sort();
    const contractIds = contracts.map((c) => c.contractId).sort();
    return { strike, expirations, types, contractIds };
  }

}

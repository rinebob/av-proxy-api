import { TimeSeriesInterval } from '@shared/alpha-vantage';
import { PartnerPhase, PartnerTrigger } from '../constants';

export interface DataReadyPayloadV1 {
  version: 'v1';
  runId: string; // YYYY-MM-DD-pre|post[-suffix]
  phase: PartnerPhase;
  intervals: TimeSeriesInterval[];
  time: number; // epoch ms
  baselinesUpdatedCount?: number;
  symbolsUpdatedCount?: number;
  universeVersion?: string;

  // Optional recommended fields
  marketDate?: string; // YYYY-MM-DD
  tz?: string; // IANA
  durationMs?: number;
  phaseWindow?: { start: number; end: number };
  datasetManifest?: string; // URL or gs:// path
  env?: 'staging' | 'prod' | string;
  traceId?: string;

  // New: origin of the message (manual, scheduled, heartbeat, test)
  trigger?: PartnerTrigger;

  // Legacy SA status (keep): begin/end
  status?: 'begin' | 'end';

  // RS header UI fields
  // Lifecycle status of the run and scheduling hints
  runStatus?: 'processing' | 'completed' | 'completed_with_errors';
  endTimeUTC?: string; // RFC3339 UTC timestamp when the refresh finished
  nextRefreshAtUTC?: string; // RFC3339 UTC timestamp when the next refresh is scheduled to begin
  finalizedAtUTC?: string; // RFC3339 UTC timestamp when new daily data was first detected (market-date level)

  // Stateless staged flow: per-run delta and remaining metadata
  pendingCount?: number; // number of symbols not yet finalized after this run
  deltaFinalizedSymbols?: string[]; // symbols finalized in THIS run only
  deltaTruncated?: boolean; // if delta list was capped
  finalizedCountTotal?: number; // cumulative finalized count as of this run
  remainingSymbols?: string[]; // morning-first END only: small sample of remaining
  remainingSampleTruncated?: boolean; // if remaining sample capped
  advisory?: 'near_complete'; // emitted once when near-complete threshold reached

  // Back-compat (legacy optional fields used previously internally)
  // These are accepted by validator but not required and not used by RS UI.
  nextFetchAt?: string; // legacy advisory label (ET or UTC string)

  // Optional: for interval-level time-series runs, conveys symbols whose
  // vendor data was stale or permanently failed for this run. This allows
  // RS to avoid or specially-handle these symbols when pulling from SA.
  retrySymbols?: string[];

  // Optional: symbols RS should explicitly include or exclude for this
  // PDR message. For initial full-universe runs, only excludeSymbols is
  // populated and RS treats the universe as tracked-symbols \ minus
  // excludeSymbols. For retry-only runs, only includeSymbols is populated
  // and RS treats the universe as exactly includeSymbols.
  includeSymbols?: string[];
  excludeSymbols?: string[];
}

export interface ValidationResult<T> {
  ok: boolean;
  value?: T;
  errors?: string[];
}

const MARKET_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_INTERVALS: TimeSeriesInterval[] = [
  TimeSeriesInterval.DAILY,
  TimeSeriesInterval.WEEKLY,
  TimeSeriesInterval.MONTHLY,
  TimeSeriesInterval.INTRADAY,
];

export function validateDataReadyPayload(input: unknown): ValidationResult<DataReadyPayloadV1> {
  const errors: string[] = [];
  const obj = (typeof input === 'object' && input !== null ? input as Record<string, any> : null);
  if (!obj) return { ok: false, errors: ['Body must be a JSON object'] };

  // Required fields
  if (obj.version !== 'v1') errors.push('version must be "v1"');
  if (typeof obj.runId !== 'string' || obj.runId.length === 0) {
    errors.push('runId is required');
  }
  if (obj.phase !== 'pre' && obj.phase !== 'post') errors.push('phase must be "pre" or "post"');

  if (!Array.isArray(obj.intervals) || obj.intervals.length === 0) {
    errors.push('intervals must be a non-empty array');
  } else {
    for (const it of obj.intervals) {
      if (!ALLOWED_INTERVALS.includes(it)) errors.push(`intervals contains invalid value: ${String(it)}`);
    }
  }

  if (typeof obj.time !== 'number' || !Number.isFinite(obj.time) || obj.time <= 0) errors.push('time must be a positive epoch ms number');

  // Optional counts
  if (obj.baselinesUpdatedCount != null && (!Number.isInteger(obj.baselinesUpdatedCount) || obj.baselinesUpdatedCount < 0)) {
    errors.push('baselinesUpdatedCount must be a non-negative integer');
  }
  if (obj.symbolsUpdatedCount != null && (!Number.isInteger(obj.symbolsUpdatedCount) || obj.symbolsUpdatedCount < 0)) {
    errors.push('symbolsUpdatedCount must be a non-negative integer');
  }

  // Optional recommended
  if (obj.marketDate != null && (typeof obj.marketDate !== 'string' || !MARKET_DATE_RE.test(obj.marketDate))) {
    errors.push('marketDate must be YYYY-MM-DD when provided');
  }
  if (obj.tz != null && typeof obj.tz !== 'string') errors.push('tz must be a string when provided');
  if (obj.durationMs != null && (!Number.isInteger(obj.durationMs) || obj.durationMs < 0)) errors.push('durationMs must be a non-negative integer when provided');
  if (obj.phaseWindow != null) {
    if (typeof obj.phaseWindow !== 'object' || obj.phaseWindow === null) {
      errors.push('phaseWindow must be an object with start/end numbers');
    } else {
      const { start, end } = obj.phaseWindow as any;
      if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end)) {
        errors.push('phaseWindow.start and phaseWindow.end must be numbers');
      } else if (end < start) {
        errors.push('phaseWindow.end must be >= phaseWindow.start');
      }
    }
  }
  if (obj.datasetManifest != null && typeof obj.datasetManifest !== 'string') errors.push('datasetManifest must be a string when provided');
  if (obj.env != null && typeof obj.env !== 'string') errors.push('env must be a string when provided');
  if (obj.traceId != null && typeof obj.traceId !== 'string') errors.push('traceId must be a string when provided');

  // Optional: trigger
  if (obj.trigger != null) {
    const allowed = [
      PartnerTrigger.MANUAL,
      PartnerTrigger.SCHEDULED,
      PartnerTrigger.HEARTBEAT,
      PartnerTrigger.TEST,
    ];
    if (!allowed.includes(obj.trigger)) {
      errors.push('trigger must be one of: manual, scheduled, heartbeat, test');
    }
  }

  // Optional: legacy SA status
  if (obj.status != null && obj.status !== 'begin' && obj.status !== 'end') {
    errors.push('status must be one of: begin, end');
  }
  // Optional: RS runStatus + timestamps and legacy nextFetchAt
  if (obj.runStatus != null) {
    const allowedRunStatuses = ['processing', 'completed', 'completed_with_errors'];
    if (!allowedRunStatuses.includes(obj.runStatus)) {
      errors.push('runStatus must be one of: processing, completed, completed_with_errors');
    }
  }
  if (obj.endTimeUTC != null && typeof obj.endTimeUTC !== 'string') {
    errors.push('endTimeUTC must be a string (RFC3339 UTC) when provided');
  }
  if (obj.nextRefreshAtUTC != null && typeof obj.nextRefreshAtUTC !== 'string') {
    errors.push('nextRefreshAtUTC must be a string (RFC3339 UTC) when provided');
  }
  if (obj.finalizedAtUTC != null && typeof obj.finalizedAtUTC !== 'string') {
    errors.push('finalizedAtUTC must be a string (RFC3339 UTC) when provided');
  }
  if (obj.pendingCount != null && (!Number.isInteger(obj.pendingCount) || obj.pendingCount < 0)) {
    errors.push('pendingCount must be a non-negative integer');
  }
  if (obj.deltaFinalizedSymbols != null && !Array.isArray(obj.deltaFinalizedSymbols)) {
    errors.push('deltaFinalizedSymbols must be an array when provided');
  }
  if (obj.deltaTruncated != null && typeof obj.deltaTruncated !== 'boolean') {
    errors.push('deltaTruncated must be a boolean when provided');
  }
  if (obj.finalizedCountTotal != null && (!Number.isInteger(obj.finalizedCountTotal) || obj.finalizedCountTotal < 0)) {
    errors.push('finalizedCountTotal must be a non-negative integer');
  }
  if (obj.remainingSymbols != null && !Array.isArray(obj.remainingSymbols)) {
    errors.push('remainingSymbols must be an array when provided');
  }
  if (obj.remainingSampleTruncated != null && typeof obj.remainingSampleTruncated !== 'boolean') {
    errors.push('remainingSampleTruncated must be a boolean when provided');
  }
  if (obj.advisory != null && obj.advisory !== 'near_complete') {
    errors.push('advisory must be "near_complete" when provided');
  }
  if (obj.nextFetchAt != null && typeof obj.nextFetchAt !== 'string') {
    errors.push('nextFetchAt must be a string when provided');
  }
  if (obj.retrySymbols != null && !Array.isArray(obj.retrySymbols)) {
    errors.push('retrySymbols must be an array when provided');
  }
  if (obj.includeSymbols != null && !Array.isArray(obj.includeSymbols)) {
    errors.push('includeSymbols must be an array when provided');
  }
  if (obj.excludeSymbols != null && !Array.isArray(obj.excludeSymbols)) {
    errors.push('excludeSymbols must be an array when provided');
  }

  if (errors.length > 0) return { ok: false, errors };

  const value: DataReadyPayloadV1 = {
    version: 'v1',
    runId: obj.runId,
    phase: obj.phase,
    intervals: obj.intervals,
    time: obj.time,
    baselinesUpdatedCount: obj.baselinesUpdatedCount,
    symbolsUpdatedCount: obj.symbolsUpdatedCount,
    universeVersion: obj.universeVersion,

    marketDate: obj.marketDate,
    tz: obj.tz,
    durationMs: obj.durationMs,
    phaseWindow: obj.phaseWindow,
    datasetManifest: obj.datasetManifest,
    env: obj.env,
    traceId: obj.traceId,
    trigger: obj.trigger,

    status: obj.status,
    runStatus: obj.runStatus,
    endTimeUTC: obj.endTimeUTC,
    nextRefreshAtUTC: obj.nextRefreshAtUTC,
    finalizedAtUTC: obj.finalizedAtUTC,
    pendingCount: obj.pendingCount,
    deltaFinalizedSymbols: obj.deltaFinalizedSymbols,
    deltaTruncated: obj.deltaTruncated,
    finalizedCountTotal: obj.finalizedCountTotal,
    remainingSymbols: obj.remainingSymbols,
    remainingSampleTruncated: obj.remainingSampleTruncated,
    advisory: obj.advisory,
    nextFetchAt: obj.nextFetchAt,

    retrySymbols: obj.retrySymbols,
    includeSymbols: obj.includeSymbols,
    excludeSymbols: obj.excludeSymbols,
  };

  // Soft check: if marketDate provided, ensure time falls within that UTC day
  if (value.marketDate) {
    try {
      const [y, m, d] = value.marketDate.split('-').map((s) => Number(s));
      const start = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
      const end = Date.UTC(y, m - 1, d, 23, 59, 59, 999);
      if (value.time < start || value.time > end) {
        // Not an error per spec; just log a warning on the server side.
        // # Reason: Allow for clock skew and operational flexibility.
        // Consumers may flag this in runs/{runId}.warnings later.
      }
    } catch {
      // ignore
    }
  }

  return { ok: true, value };
}

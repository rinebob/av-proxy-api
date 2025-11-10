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

  // New: origin of the message (manual, scheduled, heartbeat)
  trigger?: PartnerTrigger;

  // New: lifecycle status of the run and next scheduled fetch time
  status?: 'begin' | 'end';
  nextFetchAt?: string; // ISO datetime in ET or UTC; advisory only
}

export interface ValidationResult<T> {
  ok: boolean;
  value?: T;
  errors?: string[];
}

// Allow optional unique suffix (lowercase letters/digits, 1-16 chars) after base date-phase
const RUN_ID_RE = /^\d{4}-\d{2}-\d{2}-(pre|post)(-[a-z0-9]{1,16})?$/;
const MARKET_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_INTERVALS: TimeSeriesInterval[] = [
  TimeSeriesInterval.DAILY,
  TimeSeriesInterval.WEEKLY,
  TimeSeriesInterval.MONTHLY,
];

export function validateDataReadyPayload(input: unknown): ValidationResult<DataReadyPayloadV1> {
  const errors: string[] = [];
  const obj = (typeof input === 'object' && input !== null ? input as Record<string, any> : null);
  if (!obj) return { ok: false, errors: ['Body must be a JSON object'] };

  // Required fields
  if (obj.version !== 'v1') errors.push('version must be "v1"');
  if (typeof obj.runId !== 'string' || obj.runId.length === 0) errors.push('runId is required');
  if (obj.runId && !RUN_ID_RE.test(obj.runId)) {
    errors.push('runId should match YYYY-MM-DD-(pre|post)[-suffix], where optional suffix is 1-16 lowercase letters/digits');
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
    const allowed = [PartnerTrigger.MANUAL, PartnerTrigger.SCHEDULED, PartnerTrigger.HEARTBEAT];
    if (!allowed.includes(obj.trigger)) {
      errors.push('trigger must be one of: manual, scheduled, heartbeat');
    }
  }

  // Optional: status and nextFetchAt
  if (obj.status != null && obj.status !== 'begin' && obj.status !== 'end') {
    errors.push('status must be "begin" or "end" when provided');
  }
  if (obj.nextFetchAt != null && typeof obj.nextFetchAt !== 'string') {
    errors.push('nextFetchAt must be a string (ISO datetime) when provided');
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
    nextFetchAt: obj.nextFetchAt,
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

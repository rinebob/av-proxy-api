/**
 * Detection logic for the data-quality scan.
 *
 * Each detection function is a pure function that takes parsed observations
 * plus contract metadata and returns an array of anomalies.  The main
 * scan script calls `runAllDetections` to collect every anomaly for a file.
 */

import { estimateUnderlying, countWeekdays } from './data-quality-utils';
import type { UnderlyingCloses } from './underlying-closes.service';
import { lookupUnderlyingClose } from './underlying-closes.service';

/** A single parsed observation from a JSONL line. */
export interface ParsedObs {
  d: string;
  l: number | null;
  m: number | null;
  b: number | null;
  a: number | null;
  v: number | null;
  oi: number | null;
  iv: number | null;
  de: number | null;
  g: number | null;
  t: number | null;
  ve: number | null;
  r: number | null;
}

/** All possible anomaly type labels. */
export type AnomalyType =
  | 'ZERO_DROP_RECOVERY'
  | 'TRAILING_ZEROS'
  | 'MARK_ZERO_DROP_RECOVERY'
  | 'MARK_TRAILING_ZEROS'
  | 'STALE_DATA'
  | 'DUPLICATE_DATE'
  | 'OUT_OF_ORDER'
  | 'NEGATIVE_PRICE'
  | 'MISSING_LAST'
  | 'MISSING_MARK'
  | 'POST_EXPIRATION'
  | 'OBSERVATION_GAP'
  | 'BS_ANOMALY';

/** Shared base fields passed to every detection function. */
export type AnomalyBase = Pick<
  Anomaly,
  'contractId' | 'expiration' | 'strike' | 'type' | 'totalObs' | 'firstTradedDate' | 'fileStartDate' | 'fileEndDate'
>;

/** One anomaly event found in a file. */
export interface Anomaly {
  contractId: string;
  expiration: string;
  strike: string;
  type: string;
  anomalyType: AnomalyType;
  severity: 'high' | 'medium' | 'low';
  affectedDate: string;
  affectedDateEnd: string;
  detail: string;
  valueBefore: string;
  valueAfter: string;
  zeroRunLength: number;
  isTrailingZeros: boolean;
  expectedObs: number;
  actualObs: number;
  obsDeficiencyPct: number;
  daysToExpiration: number | null;
  isEarlyStart: boolean;
  totalObs: number;
  firstTradedDate: string;
  fileStartDate: string;
  fileEndDate: string;
}

/** Configuration thresholds for detection functions. */
export interface DetectConfig {
  previousThreshold: number;
  zeroThreshold: number;
  staleThreshold: number;
  staleMinPrice: number;
  spikeThresholdPct: number;
  obsDeficiencyPct: number;
  obsGapMinDays: number;
  dataStartDate: string;
  riskFreeRate: number;
  bsDeviationThreshold: number;
  bsMinDaysToExpiration: number;
  enableBsCheck: boolean;
  markPreviousThreshold: number;
  markZeroThreshold: number;
}

/** Default configuration values. */
export const DEFAULT_CONFIG: DetectConfig = {
  previousThreshold: 1.0,
  zeroThreshold: 0.05,
  staleThreshold: 10,
  staleMinPrice: 0.10,
  spikeThresholdPct: 100,
  obsDeficiencyPct: 20,
  obsGapMinDays: 1,
  dataStartDate: '2023-01-01',
  riskFreeRate: 0.04,
  bsDeviationThreshold: 0.30,
  bsMinDaysToExpiration: 7,
  enableBsCheck: false,
  markPreviousThreshold: 5.0,
  markZeroThreshold: 0.001,
};

function numField(value: string | undefined): number | null {
  if (value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Parses a raw JSONL line into a ParsedObs, or returns undefined. */
export function parseObsLine(line: string): ParsedObs | undefined {
  try {
    const p = JSON.parse(line);
    if (typeof p?.d !== 'string') return undefined;
    return {
      d: p.d,
      l: numField(p.l),
      m: numField(p.m),
      b: numField(p.b),
      a: numField(p.a),
      v: numField(p.v),
      oi: numField(p.oi),
      iv: numField(p.iv),
      de: numField(p.de),
      g: numField(p.g),
      t: numField(p.t),
      ve: numField(p.ve),
      r: numField(p.r),
    };
  } catch {
    return undefined;
  }
}

function calendarDays(start: string, end: string): number | null {
  const s = Date.parse(`${start}T00:00:00.000Z`);
  const e = Date.parse(`${end}T00:00:00.000Z`);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
  return Math.round((e - s) / 86_400_000);
}

function makeBaseAnomaly(
  contractId: string,
  expiration: string,
  strike: string,
  type: string,
  obs: ParsedObs[],
  firstTradedDate: string,
): AnomalyBase {
  return {
    contractId,
    expiration,
    strike,
    type,
    totalObs: obs.length,
    firstTradedDate,
    fileStartDate: obs.length > 0 ? obs[0].d : '',
    fileEndDate: obs.length > 0 ? obs[obs.length - 1].d : '',
  };
}

/**
 * Generic zero-drop detection for a single price field.  Scans for
 * transitions from >= previousThreshold to <= zeroThreshold, tracks the
 * full zero run, and records whether it recovers or trails to end of file.
 *
 * When `shouldFlag` is provided, it is called for each candidate drop;
 * returning false skips that drop (used for ITM filtering on mark).
 */
function detectZeroDropsForField(
  obs: ParsedObs[],
  base: AnomalyBase,
  fieldKey: 'l' | 'm',
  previousThreshold: number,
  zeroThreshold: number,
  trailingType: AnomalyType,
  recoveryType: AnomalyType,
  shouldFlag?: (dropDate: string) => boolean,
): Anomaly[] {
  const anomalies: Anomaly[] = [];
  if (obs.length < 2) return anomalies;

  let i = 1;
  while (i < obs.length) {
    const prev = obs[i - 1];
    const curr = obs[i];

    const prevVal = prev[fieldKey];
    const currVal = curr[fieldKey];

    if (
      prevVal !== null &&
      prevVal >= previousThreshold &&
      currVal !== null &&
      currVal <= zeroThreshold
    ) {
      const dropDate = curr.d;

      if (shouldFlag && !shouldFlag(dropDate)) {
        i++;
        continue;
      }

      let runEnd = i;
      while (
        runEnd + 1 < obs.length &&
        obs[runEnd + 1][fieldKey] !== null &&
        obs[runEnd + 1][fieldKey]! <= zeroThreshold
      ) {
        runEnd++;
      }

      const zeroRunLength = runEnd - i + 1;
      const zeroRunEndDate = obs[runEnd].d;
      const isTrailing = runEnd === obs.length - 1;
      const daysToExp = base.expiration ? calendarDays(dropDate, base.expiration) : null;

      anomalies.push({
        ...base,
        anomalyType: isTrailing ? trailingType : recoveryType,
        severity: 'high',
        affectedDate: dropDate,
        affectedDateEnd: zeroRunEndDate,
        detail: isTrailing
          ? `${fieldKey} dropped from ${prevVal?.toFixed(2)} to ${currVal?.toFixed(2)} and never recovered (trailing zeros to end of file)`
          : `${fieldKey} dropped from ${prevVal?.toFixed(2)} to ${currVal?.toFixed(2)}, recovered after ${zeroRunLength} zero days`,
        valueBefore: prevVal?.toFixed(2) ?? '',
        valueAfter: currVal?.toFixed(2) ?? '',
        zeroRunLength,
        isTrailingZeros: isTrailing,
        expectedObs: 0,
        actualObs: 0,
        obsDeficiencyPct: 0,
        daysToExpiration: daysToExp,
        isEarlyStart: false,
      });

      i = runEnd + 1;
    } else {
      i++;
    }
  }

  return anomalies;
}

/**
 * Detects overnight zero drops: l transitions from >= previousThreshold
 * to <= zeroThreshold in a single observation step.  Tracks the full zero
 * run, whether it recovers, and whether it trails to end of file.
 */
export function detectZeroDrops(
  obs: ParsedObs[],
  base: AnomalyBase,
  config: DetectConfig,
): Anomaly[] {
  return detectZeroDropsForField(
    obs, base, 'l',
    config.previousThreshold, config.zeroThreshold,
    'TRAILING_ZEROS', 'ZERO_DROP_RECOVERY',
  );
}

/**
 * Detects overnight zero drops in mark (m): m transitions from >= markPreviousThreshold
 * to <= markZeroThreshold in a single observation step.  Tracks the full zero
 * run, whether it recovers, and whether it trails to end of file.
 *
 * When `underlyingCloses` is provided, only flags drops where the option is
 * ITM (has intrinsic value) at the drop date — OTM options legitimately
 * expire worthless.
 */
export function detectMarkZeroDrops(
  obs: ParsedObs[],
  base: AnomalyBase,
  config: DetectConfig,
  underlyingCloses?: UnderlyingCloses,
): Anomaly[] {
  // # Reason: Build an ITM filter closure when underlying closes are available.
  // OTM options legitimately go to zero near expiration, so we only flag drops
  // where the option has intrinsic value at the drop date.
  let shouldFlag: ((dropDate: string) => boolean) | undefined;

  if (underlyingCloses) {
    const symbol = base.contractId.match(/^[A-Z]+/)?.[0] ?? '';
    const strikeNum = Number(base.strike);

    shouldFlag = (dropDate: string) => {
      const symMap = underlyingCloses.get(symbol);
      if (!symMap) return false;

      const underlyingClose = lookupUnderlyingClose(symMap, dropDate);
      if (underlyingClose == null) return false;

      // # Reason: If we can't determine moneyness (no underlying data), skip it.
      if (base.type === 'call') return underlyingClose > strikeNum;
      if (base.type === 'put') return underlyingClose < strikeNum;
      return false;
    };
  }

  return detectZeroDropsForField(
    obs, base, 'm',
    config.markPreviousThreshold, config.markZeroThreshold,
    'MARK_TRAILING_ZEROS', 'MARK_ZERO_DROP_RECOVERY',
    shouldFlag,
  );
}

/**
 * Detects stale data: l and m both remain exactly the same for
 * staleThreshold+ consecutive observations.  This indicates the data
 * feed stopped updating but kept emitting the last known values.
 */
export function detectStaleData(
  obs: ParsedObs[],
  base: AnomalyBase,
  config: DetectConfig,
): Anomaly[] {
  const anomalies: Anomaly[] = [];
  if (obs.length < config.staleThreshold) return anomalies;

  let streakStart = 0;
  for (let i = 1; i <= obs.length; i++) {
    const prev = obs[i - 1];
    const curr = i < obs.length ? obs[i] : null;

    const sameLM =
      curr !== null &&
      curr.l !== null &&
      prev.l !== null &&
      curr.l === prev.l &&
      curr.m !== null &&
      prev.m !== null &&
      curr.m === prev.m;

    if (!sameLM) {
      const streakLen = i - streakStart;
      if (streakLen >= config.staleThreshold) {
        const streakPrice = obs[streakStart].l;
        if (streakPrice === null || streakPrice >= config.staleMinPrice) {
          const isTrailing = i === obs.length;
          anomalies.push({
          ...base,
          anomalyType: 'STALE_DATA',
          severity: isTrailing ? 'high' : 'medium',
          affectedDate: obs[streakStart].d,
          affectedDateEnd: obs[i - 1].d,
          detail: `l and m unchanged for ${streakLen} consecutive observations (${obs[streakStart].d} to ${obs[i - 1].d})`,
          valueBefore: obs[streakStart].l?.toFixed(2) ?? '',
          valueAfter: obs[i - 1].l?.toFixed(2) ?? '',
          zeroRunLength: 0,
          isTrailingZeros: isTrailing,
          expectedObs: 0,
          actualObs: 0,
          obsDeficiencyPct: 0,
          daysToExpiration: null,
          isEarlyStart: false,
        });
        }
      }
      streakStart = i;
    }
  }

  return anomalies;
}

/**
 * Detects structural issues: duplicate dates, out-of-order dates,
 * negative prices, missing l field, and post-expiration observations.
 */
export function detectStructuralIssues(
  obs: ParsedObs[],
  base: AnomalyBase,
): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const seenDates = new Set<string>();

  for (let i = 0; i < obs.length; i++) {
    const o = obs[i];

    if (seenDates.has(o.d)) {
      anomalies.push({
        ...base,
        anomalyType: 'DUPLICATE_DATE',
        severity: 'medium',
        affectedDate: o.d,
        affectedDateEnd: o.d,
        detail: `Duplicate date ${o.d} appears more than once`,
        valueBefore: '',
        valueAfter: '',
        zeroRunLength: 0,
        isTrailingZeros: false,
        expectedObs: 0,
        actualObs: 0,
        obsDeficiencyPct: 0,
        daysToExpiration: null,
        isEarlyStart: false,
      });
    }
    seenDates.add(o.d);

    if (i > 0 && o.d < obs[i - 1].d) {
      anomalies.push({
        ...base,
        anomalyType: 'OUT_OF_ORDER',
        severity: 'medium',
        affectedDate: o.d,
        affectedDateEnd: obs[i - 1].d,
        detail: `Date ${o.d} appears after ${obs[i - 1].d}`,
        valueBefore: obs[i - 1].d,
        valueAfter: o.d,
        zeroRunLength: 0,
        isTrailingZeros: false,
        expectedObs: 0,
        actualObs: 0,
        obsDeficiencyPct: 0,
        daysToExpiration: null,
        isEarlyStart: false,
      });
    }

    if (o.l !== null && o.l < 0) {
      anomalies.push({
        ...base,
        anomalyType: 'NEGATIVE_PRICE',
        severity: 'high',
        affectedDate: o.d,
        affectedDateEnd: o.d,
        detail: `Negative last price: ${o.l}`,
        valueBefore: '',
        valueAfter: String(o.l),
        zeroRunLength: 0,
        isTrailingZeros: false,
        expectedObs: 0,
        actualObs: 0,
        obsDeficiencyPct: 0,
        daysToExpiration: null,
        isEarlyStart: false,
      });
    }

    if (o.l === null) {
      anomalies.push({
        ...base,
        anomalyType: 'MISSING_LAST',
        severity: 'medium',
        affectedDate: o.d,
        affectedDateEnd: o.d,
        detail: `Observation on ${o.d} has no l (last) field`,
        valueBefore: '',
        valueAfter: '',
        zeroRunLength: 0,
        isTrailingZeros: false,
        expectedObs: 0,
        actualObs: 0,
        obsDeficiencyPct: 0,
        daysToExpiration: null,
        isEarlyStart: false,
      });
    }

    if (o.m === null) {
      anomalies.push({
        ...base,
        anomalyType: 'MISSING_MARK',
        severity: 'medium',
        affectedDate: o.d,
        affectedDateEnd: o.d,
        detail: `Observation on ${o.d} has no m (mark) field`,
        valueBefore: '',
        valueAfter: '',
        zeroRunLength: 0,
        isTrailingZeros: false,
        expectedObs: 0,
        actualObs: 0,
        obsDeficiencyPct: 0,
        daysToExpiration: null,
        isEarlyStart: false,
      });
    }

    if (base.expiration && o.d > base.expiration) {
      anomalies.push({
        ...base,
        anomalyType: 'POST_EXPIRATION',
        severity: 'high',
        affectedDate: o.d,
        affectedDateEnd: o.d,
        detail: `Observation on ${o.d} is after expiration ${base.expiration}`,
        valueBefore: base.expiration,
        valueAfter: o.d,
        zeroRunLength: 0,
        isTrailingZeros: false,
        expectedObs: 0,
        actualObs: 0,
        obsDeficiencyPct: 0,
        daysToExpiration: null,
        isEarlyStart: false,
      });
    }
  }

  return anomalies;
}

/**
 * Detects observation gaps: compares actual observation count to the
 * expected number of trading days in the file's date range.
 */
export function detectObservationGaps(
  obs: ParsedObs[],
  base: AnomalyBase,
  config: DetectConfig,
): Anomaly[] {
  const anomalies: Anomaly[] = [];
  if (obs.length === 0) return anomalies;

  const fileStart = obs[0].d;
  const fileEnd = obs[obs.length - 1].d;
  const effectiveEnd = base.expiration && fileEnd > base.expiration ? base.expiration : fileEnd;

  const expected = countWeekdays(fileStart, effectiveEnd);
  const actual = obs.length;
  const deficiencyPct = expected > 0 ? ((expected - actual) / expected) * 100 : 0;
  const deficiencyDays = expected - actual;

  if (deficiencyDays > config.obsGapMinDays) {
    const daysToExp = base.expiration ? calendarDays(fileEnd, base.expiration) : null;

    anomalies.push({
      ...base,
      anomalyType: 'OBSERVATION_GAP',
      severity: deficiencyPct > 50 ? 'high' : 'medium',
      affectedDate: fileStart,
      affectedDateEnd: fileEnd,
      detail: `Expected ${expected} trading days from ${fileStart} to ${effectiveEnd}, actual ${actual} observations (${deficiencyPct.toFixed(1)}% deficient)`,
      valueBefore: String(expected),
      valueAfter: String(actual),
      zeroRunLength: 0,
      isTrailingZeros: false,
      expectedObs: expected,
      actualObs: actual,
      obsDeficiencyPct: Math.round(deficiencyPct * 10) / 10,
      daysToExpiration: daysToExp,
      isEarlyStart: false,
    });
  }

  return anomalies;
}

/**
 * Detects Black-Scholes anomalies: for each observation, estimates the
 * implied underlying price from delta, IV, strike, and time to expiration.
 * Flags observations where the implied underlying deviates more than
 * bsDeviationThreshold from the immediately preceding valid estimate.
 *
 * Only runs when enableBsCheck is true (default: false) because it is
 * computationally expensive across 350K files.
 */
export function detectBsAnomalies(
  obs: ParsedObs[],
  base: AnomalyBase,
  config: DetectConfig,
): Anomaly[] {
  if (!config.enableBsCheck) return [];
  const anomalies: Anomaly[] = [];
  if (obs.length < 5 || !base.expiration || !base.strike || !base.type) return anomalies;

  const strikeNum = Number(base.strike);
  if (!Number.isFinite(strikeNum)) return anomalies;

  const optionType = base.type as 'call' | 'put';

  // Estimate implied underlying for each observation, comparing each to
  // the immediately preceding valid estimate to detect sudden corruption.
  let prevS: number | null = null;
  for (let i = 0; i < obs.length; i++) {
    const o = obs[i];
    if (o.iv === null || o.iv <= 0 || o.de === null) continue;

    const daysToExp = calendarDays(o.d, base.expiration);
    if (daysToExp === null || daysToExp < config.bsMinDaysToExpiration) continue;

    const T = daysToExp / 365;
    const S = estimateUnderlying(optionType, strikeNum, T, config.riskFreeRate, o.iv, o.de);
    if (S === null || !Number.isFinite(S) || S <= 0) continue;

    if (prevS !== null) {
      const deviation = Math.abs(S - prevS) / prevS;
      if (deviation > config.bsDeviationThreshold) {
        anomalies.push({
          ...base,
          anomalyType: 'BS_ANOMALY',
          severity: 'medium',
          affectedDate: o.d,
          affectedDateEnd: o.d,
          detail: `Implied underlying ${S.toFixed(2)} deviates ${(deviation * 100).toFixed(1)}% from previous observation's implied underlying ${prevS.toFixed(2)} (l=${o.l?.toFixed(2) ?? 'null'}, iv=${o.iv?.toFixed(4) ?? 'null'}, delta=${o.de?.toFixed(5) ?? 'null'})`,
          valueBefore: prevS.toFixed(2),
          valueAfter: S.toFixed(2),
          zeroRunLength: 0,
          isTrailingZeros: false,
          expectedObs: 0,
          actualObs: 0,
          obsDeficiencyPct: 0,
          daysToExpiration: calendarDays(o.d, base.expiration),
          isEarlyStart: false,
        });
      }
    }

    prevS = S;
  }

  return anomalies;
}

/**
 * Runs all detection functions on a file's observations and returns
 * the combined list of anomalies.
 */
export function runAllDetections(
  obs: ParsedObs[],
  contractId: string,
  expiration: string,
  strike: string,
  type: string,
  config: DetectConfig,
  firstTradedDate: string,
): Anomaly[] {
  const base = makeBaseAnomaly(contractId, expiration, strike, type, obs, firstTradedDate);

  return [
    ...detectZeroDrops(obs, base, config),
    ...detectMarkZeroDrops(obs, base, config),
    ...detectStaleData(obs, base, config),
    ...detectStructuralIssues(obs, base),
    ...detectObservationGaps(obs, base, config),
    ...detectBsAnomalies(obs, base, config),
  ];
}

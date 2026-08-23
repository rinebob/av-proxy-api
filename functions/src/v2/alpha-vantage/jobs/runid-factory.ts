import { DayOfWeek, TimeSeriesInterval } from '@shared/alpha-vantage';
import { TradingPhase } from '@shared/health-metrics';

/**
 * Type-safe run ID factory for time-series job pipeline.
 * 
 * This replaces the legacy buildTimeSeriesRunId() and provides a single
 * source of truth for all run ID generation with proper type safety.
 */

// Branded types for run ID formats
export type RealtimeRunId = `${string}-${string}-${string}-${string}-${string}-${string}`;
export type BackfillRunId = `${string}-${string}-POST-${string}-FULL_BACKFILL`;

// Interface for realtime run parameters
export interface RealtimeRunParams {
  marketDate: string; // YYYY-MM-DD (ET)
  dow: DayOfWeek;
  interval: TimeSeriesInterval;
  isManual: boolean;
  sequence: string; // A, B, C, X, etc.
  phase: TradingPhase; // Trading phase (PRE/POST)
  clockPt: string; // Required PT time (HHMM) - always included in run ID
}

// Interface for backfill run parameters
export interface BackfillRunParams {
  marketDate: string; // YYYY-MM-DD (ET)
  dow: DayOfWeek;
  interval: TimeSeriesInterval;
}

/**
 * Factory for creating type-safe run IDs.
 * 
 * This ensures consistency across the pipeline and eliminates the
 * multiple run ID builders that previously existed.
 */
export class RunIdFactory {
  /**
   * Creates a realtime run ID for the canonical format.
   * 
   * Format: YYYY-MM-DD-DOW-SEQUENCE-INTERVAL-LIVE|MANUAL-PHASE-HHMM
   * Example: 2026-01-29-THU-A-DAILY-LIVE-POST-1335
   *
   * The clockPt is always included in the run ID for identification.
   */
  static createRealtime(params: RealtimeRunParams): RealtimeRunId {
    const { marketDate, dow, interval, isManual, sequence, phase, clockPt } = params;
    
    // Validate inputs
    if (!marketDate || !/^\d{4}-\d{2}-\d{2}$/.test(marketDate)) {
      throw new Error(`Invalid marketDate format: ${marketDate}. Expected YYYY-MM-DD`);
    }
    
    if (!sequence || sequence.length !== 1) {
      throw new Error(`Invalid sequence: ${sequence}. Expected single character`);
    }
    
    if (!clockPt || !/^\d{4}$/.test(clockPt)) {
      throw new Error(`Invalid clockPt format: ${clockPt}. Expected HHMM`);
    }
    
    const dowStr = String(dow).toUpperCase();
    const intervalStr = String(interval).toUpperCase();
    const runTypeStr = isManual ? 'MANUAL' : 'LIVE';
    const phaseStr = String(phase).toUpperCase();
    
    // Build run ID with clockPt as required component
    return `${marketDate}-${dowStr}-${sequence}-${intervalStr}-${runTypeStr}-${phaseStr}-${clockPt}` as RealtimeRunId;
  }
  
  /**
   * Creates a backfill run ID.
   * 
   * Format: YYYY-MM-DD-DOW-POST-INTERVAL-FULL_BACKFILL
   * Example: 2026-02-01-SUN-POST-DAILY-FULL_BACKFILL
   */
  static createBackfill(params: BackfillRunParams): BackfillRunId {
    const { marketDate, dow, interval } = params;
    
    // Validate inputs
    if (!marketDate || !/^\d{4}-\d{2}-\d{2}$/.test(marketDate)) {
      throw new Error(`Invalid marketDate format: ${marketDate}. Expected YYYY-MM-DD`);
    }
    
    const dowStr = String(dow).toUpperCase();
    const intervalStr = String(interval).toUpperCase();
    
    return `${marketDate}-${dowStr}-POST-${intervalStr}-FULL_BACKFILL` as BackfillRunId;
  }
  
  /**
   * Validates that a run ID matches the expected realtime format.
   * Only accepts format with required clockPt.
   */
  static isValidRealtimeRunId(runId: string): runId is RealtimeRunId {
    // Pattern with required clockPt: YYYY-MM-DD-DOW-SEQ-INTERVAL-LIVE|MANUAL-PHASE-HHMM
    const pattern = /^\d{4}-\d{2}-\d{2}-[A-Z]{3}-[A-Z]-[A-Z]+-(LIVE|MANUAL)-(PRE|POST)-\d{4}$/;
    
    return pattern.test(runId);
  }
  
  /**
   * Validates that a run ID matches the expected backfill format.
   */
  static isValidBackfillRunId(runId: string): runId is BackfillRunId {
    const pattern = /^\d{4}-\d{2}-\d{2}-[A-Z]{3}-POST-[A-Z]+-FULL_BACKFILL$/;
    return pattern.test(runId);
  }
  
  /**
   * Extracts components from a realtime run ID.
   * Handles format with required clockPt.
   */
  static parseRealtimeRunId(runId: RealtimeRunId): {
    marketDate: string;
    dow: string;
    sequence: string;
    interval: string;
    runType: string;
    phase: string;
    clockPt: string;
  } {
    if (!this.isValidRealtimeRunId(runId)) {
      throw new Error(`Invalid realtime run ID: ${runId}`);
    }
    
    // Format: YYYY-MM-DD-DOW-SEQ-INTERVAL-LIVE|MANUAL-PHASE-HHMM
    // The date contains dashes so we cannot naively split on '-'.
    // The date is always the first 10 characters (YYYY-MM-DD).
    const marketDate = runId.substring(0, 10);
    const rest = runId.substring(11); // skip the dash after date
    const [dow, sequence, interval, runType, phase, clockPt] = rest.split('-');

    return { marketDate, dow, sequence, interval, runType, phase, clockPt };
  }
  
  /**
   * Extracts components from a backfill run ID.
   */
  static parseBackfillRunId(runId: BackfillRunId): {
    marketDate: string;
    dow: string;
    interval: string;
  } {
    if (!this.isValidBackfillRunId(runId)) {
      throw new Error(`Invalid backfill run ID: ${runId}`);
    }
    
    // Format: YYYY-MM-DD-DOW-POST-INTERVAL-FULL_BACKFILL
    // The date is always the first 10 characters (YYYY-MM-DD).
    const marketDate = runId.substring(0, 10);
    const rest = runId.substring(11);
    const [dow, , interval] = rest.split('-');
    return { marketDate, dow, interval };
  }
}

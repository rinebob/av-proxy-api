/**
 * Swing-set module types (Task #124+).
 */

/** The currently developing (unconfirmed) swing's direction and latest extreme. */
export interface CurrentSwing {
  /** Direction of the developing swing: 'up' toward a new high, 'down' toward a new low. */
  direction: 'up' | 'down';
  /** YYYY-MM-DD of the current swing extreme (projection bar if present, else last confirmed pivot). */
  extremeDate: string;
}

/** Result of SwingSetGenerationService.generateForSymbol. */
export interface SwingSetGenerationResult {
  symbol: string;
  /** paramsIds written (one per canonical config when not skipped). */
  generated: string[];
  /** True when no daily-adjusted data exists for the symbol — nothing written. */
  skipped: boolean;
  reason?: string;
}

/**
 * Hilbert Transform indicator keys used by the partnerTechnicalIndicatorsV2 endpoint
 * and the FE chart-view. These map to the keys in TECHNICAL_INDICATORS_CONFIG.
 */
export enum HtIndicator {
  HT_TRENDLINE = 'ht_trendline',
  HT_SINE = 'ht_sine',
  HT_DCPERIOD = 'ht_dcperiod',
  HT_DCPHASE = 'ht_dcphase',
  HT_TRENDMODE = 'ht_trendmode',
  HT_PHASOR = 'ht_phasor',
}

/**
 * Price series types for technical indicator computation.
 * Determines which OHLC value the indicator is calculated from.
 */
export enum PriceSeries {
  CLOSE = 'close',
  OPEN = 'open',
  HIGH = 'high',
  LOW = 'low',
}

/** Display mode for HT_SINE indicator. Used by Task #25 (component UI), not Task #23. */
export type SineDisplayMode = 'overlay' | 'pane' | 'both';

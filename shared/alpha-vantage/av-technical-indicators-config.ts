/**
 * @topic #5 — Alpha Vantage Endpoint Expansion (opened 2026-08-15)
 *
 * Config-driven mapping of technical indicator names to Alpha Vantage API function names
 * and required parameters. The partner endpoint resolves the `indicator` query param
 * through this config to determine which AV function to call and which params to pass.
 *
 * Adding a new technical indicator (e.g., SMA, EMA, OBV) is a config entry here —
 * no new endpoint or code change needed.
 */

/** Configuration for a single technical indicator. */
export interface TechnicalIndicatorConfig {
  /** Alpha Vantage API function name (e.g., 'HT_TRENDLINE'). */
  function: string;
  /** Required AV params beyond symbol (e.g., ['interval', 'series_type']). */
  requiredParams: string[];
  /** Optional AV params with defaults applied when the caller omits them. */
  defaultParams?: Record<string, string>;
}

/**
 * Maps indicator names (used in the partner endpoint `indicator` query param)
 * to their Alpha Vantage API configuration.
 *
 * Hilbert Transform indicators are the first entries. Future indicators
 * (SMA, EMA, OBV, etc.) are added here without new endpoints.
 */
export const TECHNICAL_INDICATORS_CONFIG: Record<string, TechnicalIndicatorConfig> = {
  ht_trendline: {
    function: 'HT_TRENDLINE',
    requiredParams: ['interval', 'series_type'],
    defaultParams: { series_type: 'close', interval: 'daily' },
  },
  ht_sine: {
    function: 'HT_SINE',
    requiredParams: ['interval', 'series_type'],
    defaultParams: { series_type: 'close', interval: 'daily' },
  },
  ht_trendmode: {
    function: 'HT_TRENDMODE',
    requiredParams: ['interval', 'series_type'],
    defaultParams: { series_type: 'close', interval: 'daily' },
  },
  ht_dcperiod: {
    function: 'HT_DCPERIOD',
    requiredParams: ['interval', 'series_type'],
    defaultParams: { series_type: 'close', interval: 'daily' },
  },
  ht_dcphase: {
    function: 'HT_DCPHASE',
    requiredParams: ['interval', 'series_type'],
    defaultParams: { series_type: 'close', interval: 'daily' },
  },
  ht_phasor: {
    function: 'HT_PHASOR',
    requiredParams: ['interval', 'series_type'],
    defaultParams: { series_type: 'close', interval: 'daily' },
  },
};

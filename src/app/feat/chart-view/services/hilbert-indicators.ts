/**
 * Hilbert Transform Technical Indicators (client-side approximation).
 *
 * Based on John Ehlers' DSP approach from "Cycle Analytics for Traders."
 * These are approximations of the Alpha Vantage / TA-Lib HT_* endpoints:
 *   - HT_TRENDLINE  → instantaneous trendline (low-lag smoothed price)
 *   - HT_SINE       → sine and lead-sine of the cycle phase angle
 *   - HT_DCPERIOD   → dominant cycle period in bars
 *   - HT_DCPHASE    → phase angle in degrees
 *
 * NOTE: AV/TA-Lib use a more sophisticated homodyne discriminator for the
 * adaptive period. Values here will be close but not identical. Sufficient
 * for visual investigation — not for production signal generation.
 */

export interface HilbertIndicators {
  /** HT_TRENDLINE: smoothed price with reduced lag (overlays on price chart) */
  trendline: (number | null)[];
  /** HT_SINE: sin(phase angle) — oscillates -1..+1 */
  sine: (number | null)[];
  /** HT_SINE: sin(phase + 45°) — lead-sine that crosses sine at cycle turns */
  leadSine: (number | null)[];
  /** HT_DCPERIOD: dominant cycle length in bars */
  dcPeriod: (number | null)[];
  /** HT_DCPHASE: phase angle in degrees (0..360) */
  phaseAngle: (number | null)[];
}

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/**
 * Computes Hilbert Transform indicators from a close-price series.
 * @param closes Array of close prices (oldest first)
 * @returns Indicator arrays aligned to the input; first ~6 bars are null (warmup)
 */
export function calculateHilbertIndicators(closes: number[]): HilbertIndicators {
  const n = closes.length;
  const trendline: (number | null)[] = new Array(n).fill(null);
  const sine: (number | null)[] = new Array(n).fill(null);
  const leadSine: (number | null)[] = new Array(n).fill(null);
  const dcPeriod: (number | null)[] = new Array(n).fill(null);
  const phaseAngle: (number | null)[] = new Array(n).fill(null);

  if (n < 7) return { trendline, sine, leadSine, dcPeriod, phaseAngle };

  // Ehlers' filter coefficients
  const a = 0.0962;
  const b = 0.5769;

  // --- Step 1: Smooth price with 4-bar WMA ---
  const smooth: number[] = new Array(n).fill(0);
  for (let i = 3; i < n; i++) {
    smooth[i] = (4 * closes[i] + 3 * closes[i - 1] + 2 * closes[i - 2] + closes[i - 3]) / 10;
  }

  // --- Step 2: Detrend (isolate the cycle component) ---
  const detrend: number[] = new Array(n).fill(0);
  for (let i = 3; i < n; i++) {
    detrend[i] = smooth[i] - smooth[i - 3];
  }

  // --- Step 3: Hilbert Transform on the cycle → I (in-phase) and Q (quadrature) ---
  const inPhase: number[] = new Array(n).fill(0);
  const quadrature: number[] = new Array(n).fill(0);

  for (let i = 6; i < n; i++) {
    quadrature[i] = a * detrend[i] + b * detrend[i - 2] - b * detrend[i - 4] - a * detrend[i - 6];
    inPhase[i] = detrend[i - 3];

    // Phase angle from I and Q
    if (inPhase[i] !== 0 || quadrature[i] !== 0) {
      let angle = Math.atan2(quadrature[i], inPhase[i]) * RAD2DEG;
      if (angle < 0) angle += 360;
      phaseAngle[i] = angle;

      // Sine wave: sin(phase) and lead-sine sin(phase + 45°)
      const phaseRad = angle * DEG2RAD;
      sine[i] = Math.sin(phaseRad);
      leadSine[i] = Math.sin(phaseRad + 45 * DEG2RAD);
    }
  }

  // --- Step 4: Dominant Cycle Period (simplified homodyne discriminator) ---
  // period = 360 / deltaPhase, with smoothing to reduce jitter
  let lastPeriod = 20; // default cycle assumption
  const rawPeriod: number[] = new Array(n).fill(0);

  for (let i = 7; i < n; i++) {
    const prev = phaseAngle[i - 1];
    const curr = phaseAngle[i];
    if (prev == null || curr == null) {
      rawPeriod[i] = lastPeriod;
      continue;
    }
    let dp = curr - prev;
    if (dp < 0) dp += 360;
    // Reject implausible deltas (phase jumps from noise)
    if (dp > 0 && dp < 180) {
      rawPeriod[i] = 360 / dp;
    } else {
      rawPeriod[i] = lastPeriod;
    }
    lastPeriod = rawPeriod[i];
  }

  // Smooth the period with a 4-bar WMA to reduce noise
  const smoothPeriod: number[] = new Array(n).fill(0);
  for (let i = 7; i < n; i++) {
    if (i >= 10) {
      smoothPeriod[i] = (4 * rawPeriod[i] + 3 * rawPeriod[i - 1] + 2 * rawPeriod[i - 2] + rawPeriod[i - 3]) / 10;
    } else {
      smoothPeriod[i] = rawPeriod[i];
    }
    dcPeriod[i] = smoothPeriod[i];
  }

  // --- Step 5: Instantaneous Trendline (matches TA-Lib HT_TRENDLINE) ---
  // The trendline is an SMA of price over the dominant cycle period,
  // which notches out the cycle component, leaving just the trend.
  // That SMA is then further smoothed with a 4-bar WMA.
  let iTrend1 = 0, iTrend2 = 0, iTrend3 = 0;

  for (let i = 7; i < n; i++) {
    const period = smoothPeriod[i] ?? 20;
    // Clamp period to TA-Lib bounds
    const clamped = Math.max(6, Math.min(50, period));
    const dcPeriodInt = Math.round(clamped);

    // SMA of raw close price over the dominant cycle period
    let sma = 0;
    if (dcPeriodInt > 0 && i >= dcPeriodInt) {
      let sum = 0;
      for (let j = 0; j < dcPeriodInt; j++) {
        sum += closes[i - j];
      }
      sma = sum / dcPeriodInt;
    }

    // WMA-smooth the SMA using the last 3 trendline values
    const smoothed = (4 * sma + 3 * iTrend1 + 2 * iTrend2 + iTrend3) / 10;
    iTrend3 = iTrend2;
    iTrend2 = iTrend1;
    iTrend1 = sma;

    trendline[i] = smoothed;
  }

  return { trendline, sine, leadSine, dcPeriod, phaseAngle };
}

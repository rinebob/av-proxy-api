# Deep Dive: The Hilbert Transform in Technical Analysis

This document provides a comprehensive overview of using the Hilbert Transform for technical analysis (TA) and implementing it inside a custom TypeScript trading application.

---

## 1. What is the Hilbert Transform?

In technical analysis, the **Hilbert Transform** acts as a digital signal processing (DSP) tool—pioneered for trading by John Ehlers—that shifts the phase of price data by 90 degrees. 

This 90-degree shift splits a real price series into two orthogonal components (**In-Phase** and **Quadrature**) to construct a complex analytic signal. This lets indicators measure hidden market cycles without the massive lag of traditional moving averages.

### Core Functions in Trading
* **Cycle Identification:** It isolates the dominant cycle or rhythm present in choppy or oscillating price data.
* **Phase and Timing Detection:** It pinpoints where current prices sit within a cyclical wave (identifying tops, bottoms, or inflection points).
* **Trend vs. Cycle Mode Distinction:** It helps algorithms figure out if the market is moving directionally in a trend or oscillating sideways in a trading range, allowing traders to switch strategies accordingly.
* **Lag Reduction:** By using quadrature components, it creates adaptive moving averages and oscillators (like the Hilbert Transform Sine Wave) that react faster to turning points than standard indicators.

---

## 2. Applying the Hilbert Transform to Custom Indicators

To use the Hilbert Transform on your own custom indicators, you pass your indicator's data line (instead of raw price data) into the transform. 

Think of the Hilbert Transform as a special filter. It takes any wavy line you give it, creates a clone of that line, and pushes that clone forward by exactly **one-quarter of a wave** (a 90-degree phase shift). By comparing your original indicator line with this shifted clone, you can build advanced, lag-free trading systems.

### Step-by-Step Implementation Process

1. **Prepare Your Indicator's Output:** Your indicator must produce a continuous, oscillating line (e.g., Custom Momentum lines, Smoothed Volume indicators, or Unique Price Spreads).
2. **Generate the Two Core Components:** Run your indicator data through a Hilbert Transform algorithm to output two components:
   * **In-Phase (I):** This is just your original indicator line, slightly smoothed to remove random noise.
   * **Quadrature (Q):** This is your indicator line shifted 90 degrees back in phase (quarter-cycle lag).
3. **Calculate Market Metrics:** Once you have I and Q for your indicator, you can calculate three powerful metrics:
   * **The Phase Angle:** Tells you exactly where your indicator is in its current cycle (from 0° to 360°).
     $$\text{Phase} = \arctan\left(\frac{Q}{I}\right)$$
   * **The Dominant Cycle Period:** Tells you exactly how many bars long the current market wave is (e.g., a 22-day cycle).
   * **The Homodyne Discriminator:** A math formula that constantly counts the rate of change of the phase angle to update the cycle length automatically.

### 3 Trading Application Ideas

* **Option A (Adaptive Version):** Use the Hilbert Transform to find the current **Dominant Cycle Period** of your indicator. If the market cycle is 28 bars, automatically change your indicator's lookback period to 14 (half the cycle) so it adapts dynamically to changing market speeds.
* **Option B (Sine Wave Predictor Cross):** Plot the **Sine** of the Phase Angle against the **Cosine** (or a Lead-Sine shifted by another 45°). When these lines cross, it signals that your custom indicator has reached a cyclical top or bottom.
* **Option C (Trend vs. Cycle Filter):** If the Phase Angle rotates smoothly from 0° to 360°, trust your indicator's overbought/oversold levels. If the Phase Angle stalls or goes flat, ignore those levels because the market is in a strong directional trend.

---

## 3. TypeScript Implementation

Below is a dependency-free TypeScript setup utilizing John Ehlers' 7-element math filter to process your indicator's array data.

```typescript
// 1. Define the structural shapes for our transform data
interface HilbertResult {
  inPhase: number[];
  quadrature: number[];
  phaseAngle: number[]; // In degrees (0 to 360)
}

/**
 * Calculates the Hilbert Transform on a custom indicator data array.
 * Uses John Ehlers' 90-degree phase shift math filter.
 * @param data Array of numbers from your custom indicator
 */
export function calculateHilbertTransform(data: number[]): HilbertResult {
  const size = data.length;
  
  // Initialize empty output arrays filled with zeros
  const inPhase: number[] = new Array(size).fill(0);
  const quadrature: number[] = new Array(size).fill(0);
  const phaseAngle: number[] = new Array(size).fill(0);

  // We need at least 7 bars of historical data to run the math filter safely
  if (size < 7) {
    return { inPhase, quadrature, phaseAngle };
  }

  // Loop through the data starting at index 6 (the 7th item)
  for (let i = 6; i < size; i++) {
    
    // Step A: Calculate Quadrature (The 90-degree shifted clone)
    // This formula applies specific weights to older data points to shift the wave
    quadrature[i] = (
      0.0962 * data[i] + 
      0.5769 * data[i - 2] - 
      0.5769 * data[i - 4] - 
      0.0962 * data[i - 6]
    );

    // Step B: Calculate In-Phase (The original signal, adjusted for the math delay)
    // We look back 3 bars so the timing perfectly matches the Quadrature calculation
    inPhase[i] = data[i - 3];

    // Step C: Calculate the Phase Angle using Arctangent (y, x)
    if (inPhase[i] !== 0) {
      // Math.atan2 returns radians. We convert it to degrees.
      let angleRad = Math.atan2(quadrature[i], inPhase[i]);
      let angleDeg = angleRad * (180 / Math.PI);

      // Keep the final angle beautifully clean between 0 and 360 degrees
      if (angleDeg < 0) {
        angleDeg += 360;
      }
      phaseAngle[i] = angleDeg;
    } else {
      // Fallback to previous angle if dividing by zero
      phaseAngle[i] = phaseAngle[i - 1];
    }
  }

  return { inPhase, quadrature, phaseAngle };
}
```

### Application Integration
```typescript
// Example usage:
const myCustomIndicatorData = [10, 12, 11, 14, 13, 16, 15, 18, 17, 20];

const hilbertData = calculateHilbertTransform(myCustomIndicatorData);

// Grab the current bar's metrics for trading signals
const lastIndex = myCustomIndicatorData.length - 1;

console.log("Current Phase Angle:", hilbertData.phaseAngle[lastIndex]);
console.log("Current In-Phase Line:", hilbertData.inPhase[lastIndex]);
console.log("Current Quadrature Line:", hilbertData.quadrature[lastIndex]);
```

### Architecture Tips for App Developers
* **The 7-Bar Warmup Lag:** Because the filter looks back 6 bars (`data[i - 6]`), the first 6 items in your returned arrays will always be `0`. Your UI or trading engine should ignore these warm-up periods.
* **Array Memory Management:** For live streaming data (like WebSockets), avoid recalculating the whole array on every tick. Optimize by saving states and only pushing updates on new bar closes.
# Hilbert Transform Cycle Analysis — TypeScript Implementation Roadmap

**Purpose:** hand this to a coding assistant as a build spec. It defines libraries, project
layout, the exact signal chain, and a validation harness with measured pass/fail thresholds.

**Core principle:** the Hilbert transform is not a smoothing filter. It is a −90° phase
shifter used to build an *analytic signal*, from which you read instantaneous amplitude,
phase, and period. It only produces meaningful output on a **narrowband, zero-mean** input,
so the detrending stage is mandatory, not optional.

> Every numeric threshold in the Validation section was measured by actually running this
> pipeline on synthetic data. They are not estimates. See "Reference measurements".

---

## 1. Libraries

### Required

| Concern | Package | Notes |
|---|---|---|
| Market data | `yahoo-finance2` | TS-first, good types. Use the **`chart`** module, not `historical` — `historical` still works but `chart` is the maintained path with more options. CJS consumers need `require('yahoo-finance2').default`. Yahoo has restricted parts of their API over time; if `chart` breaks, swap this layer out — keep it behind an interface. |
| Testing | `vitest` | Fast, native TS/ESM, no config needed. |
| Seeded RNG | `pure-rand` or `seedrandom` | Required — the random-walk null test must be reproducible. |

### Do NOT add a numerics library for the DSP core

Every filter here is a scalar recurrence or a 7-tap convolution over `Float64Array`.
Adding `danfojs` / `mathjs` / `ml-matrix` buys nothing and hurts clarity and speed.
Native typed arrays only in `src/dsp/`.

### Optional

| Concern | Package | When to use |
|---|---|---|
| Reference/oracle FFT | `fft.js` (indutny) | Only for the non-causal reference implementation in the test harness. Radix-4/2, requires power-of-two length — zero-pad. Not needed in production code. |
| TA-Lib cross-check | `talib.js` or `talib-web` (WASM) | Both are WASM ports of TA-Lib C. Async `await talib.init()` before use. **Verify at install time** that `HT_DCPERIOD`, `HT_DCPHASE`, `HT_PHASOR`, `HT_SINE`, `HT_TRENDMODE`, `HT_TRENDLINE`, `MAMA` are actually exported — the ports don't all expose the full C surface, and their docs are thin. Use only to cross-check your own implementation, not as the primary path (you want to own this code so you can inspect intermediate stages). Avoid the native `talib` binding unless you accept node-gyp builds and lose browser support. |
| Charting | `lightweight-charts` (TradingView) | Browser panels. Best-in-class for price series. Pair with a plain canvas/SVG panel for the oscillator subplots. |
| Headless charts | `vega-lite` + `vega` | If you want PNG diagnostics out of Node in CI. |

---

## 2. Project layout

```
src/
  data/
    source.ts          // interface Bars { t: Float64Array; o,h,l,c,v: Float64Array }
    yahoo.ts           // yahoo-finance2 chart -> Bars
    synthetic.ts       // sine, chirp, random-walk generators (seeded)
  dsp/
    highpass.ts        // 2-pole Butterworth high-pass
    supersmoother.ts   // 2-pole Butterworth low-pass
    roofing.ts         // highpass -> supersmoother
    hilbert.ts         // causal Ehlers FIR quadrature  <- production
    hilbertFft.ts      // FFT analytic signal           <- tests only, non-causal
    analytic.ts        // amplitude / phase / period extraction
    period.ts          // clamping, rate limiting, smoothing
  indicators/
    trendline.ts       // instantaneous trendline
    snr.ts             // signal-to-noise / cycle strength
    trendMode.ts       // trend vs cycle regime flag
    adaptive.ts        // variable-lookback RSI / stochastic
  validate/
    *.test.ts
```

**Contract for every DSP function:** `(input: Float64Array, ...params) => Float64Array`.
Pure, no classes, no allocation in loops beyond the single output array.

**Warmup handling:** fill the first `WARMUP = 150` samples with `NaN`, not `0`.
Zero-filling hides bugs; NaN makes them propagate loudly. Every downstream consumer
slices from `WARMUP`.

---

## 3. The signal chain

### Stage 0 — Input series

Use **median price** `(high + low) / 2`, which is what Ehlers' originals use and is
noticeably smoother than close. Convert to a `Float64Array`. Log-transform if your window
spans a large price range; the high-pass removes the level either way, so it matters less
than you'd think, but logs make amplitude comparable across regimes.

Fetch **at least 1000 bars**. You discard 150 to warmup and need the rest for validation.

### Stage 1 — Roofing filter (MANDATORY)

This is the stage people skip, and skipping it is why raw Hilbert output looks like noise.
Two cascaded 2-pole Butterworth sections that band-limit price to roughly 10–48 bars.

**1a. High-pass, cutoff 48 bars** — removes trend and DC:

```
a     = 0.707 * 2π / 48
alpha = (cos(a) + sin(a) − 1) / cos(a)          // = 0.088513
k     = (1 − alpha/2)²

HP[i] = k*(x[i] − 2*x[i−1] + x[i−2])
      + 2*(1 − alpha)*HP[i−1]
      − (1 − alpha)²*HP[i−2]
```

**1b. Super Smoother, cutoff 10 bars** — removes tick noise and aliasing:

```
a1 = exp(−1.414π / 10)
b1 = 2*a1*cos(1.414π / 10)
c2 = b1                                          // = 1.158161
c3 = −a1²                                        // = −0.411296
c1 = 1 − c2 − c3                                 // = 0.253135

F[i] = c1*(HP[i] + HP[i−1])/2 + c2*F[i−1] + c3*F[i−2]
```

Sanity assertion for the LLM to write as a unit test: `c1 + c2 + c3 === 1` (DC gain of 1).

Both are IIR — strictly sequential, seed indices 0 and 1 to zero, start the loop at `i = 2`.
Output `F` is your zero-mean, band-limited signal. **Everything downstream consumes `F`, never raw price.**

### Stage 2 — Causal Hilbert (Ehlers 7-tap quadrature)

```
Q[i] = (0.0962*F[i] + 0.5769*F[i−2] − 0.5769*F[i−4] − 0.0962*F[i−6])
       * (0.075*smoothPeriod[i−1] + 0.54)
I[i] = F[i−3]
```

Two things that are easy to get wrong:

- **`I` is the signal delayed by 3 bars**, matching the FIR's group delay. If you use
  `F[i]` for the in-phase component the quadrature relationship is broken and nothing
  downstream works.
- The `(0.075*period + 0.54)` term is **gain compensation** — the FIR's amplitude response
  is frequency-dependent, so it's normalized using the *previous* bar's period estimate.
  This makes Stage 2 and Stage 4 a feedback loop. Seed `smoothPeriod` to 15.0.

### Stage 3 — Analytic signal → phase advance

Compute the phase step via the complex product `z[i] · conj(z[i−1])`, which is numerically
better behaved than differencing two `atan2` calls and needs no unwrapping:

```
re   = I[i]*I[i−1] + Q[i]*Q[i−1]
im   = Q[i]*I[i−1] − I[i]*Q[i−1]
dPhi = −atan2(im, re)        // NOTE THE MINUS SIGN
```

> **Gotcha that will cost you a day.** With this quadrature convention the phase advance
> comes out **negative**. Verified: on a clean 20-bar sine, `atan2(im, re)` returns
> −0.31416 rad/bar, i.e. exactly −2π/20. If you take the positive value, every estimate
> falls below the lower clamp, gets pinned to the 50-bar ceiling, and your output is a
> flat line at 50 forever. Assert in a unit test that a 20-bar sine yields `dPhi ≈ +0.31416`
> after the sign fix.

```
rawPeriod = dPhi <= 1e−6 ? 50 : 2π / dPhi
```

Amplitude and phase, for the other outputs:

```
amplitude[i] = sqrt(I[i]² + Q[i]²)
phase[i]     = atan2(Q[i], I[i])
```

### Stage 4 — Period stabilization

Raw period estimates are far too jumpy to use. Apply all three steps in order:

```
// 1. rate limit — period cannot jump more than +50% / −33% per bar
p = min(p, 1.5  * smoothPeriod[i−1])
p = max(p, 0.67 * smoothPeriod[i−1])

// 2. hard clamp to the tradeable range
p = clamp(p, 6, 50)

// 3. heavy EMA smoothing
smoothPeriod[i] = 0.2*p + 0.8*smoothPeriod[i−1]
```

`smoothPeriod` feeds back into Stage 2. This is the dominant cycle period output.

### Stage 5 — Derived outputs

**Instantaneous trendline** — average `F` over one full dominant cycle and add back the
removed low-frequency component. Equivalently: price minus the measured cycle component.
Less lag than an SMA of comparable smoothness.

**SNR / cycle strength** — the honest gate on whether any of this is tradeable:

```
snr[i] = 10 * log10( amplitude[i]² / (0.5*(high[i]−low[i]))² )
```

Ehlers' rule of thumb is that below ~6 dB the cycle swing is smaller than the bar noise
and cycle signals are meaningless. Gate all cycle-based entries on `snr > 6`.

**Trend mode flag** — set `trendMode = 1` (trend, not cycle) when any of:
`snr < 6`, phase fails to advance monotonically over the last half-cycle, or the
instantaneous trendline slope exceeds the cycle amplitude over one period.
Use this to *route* strategies: oscillators only in cycle mode, breakout/trend-following
only in trend mode. Phase-based turning-point signals whipsaw catastrophically in trend mode.

**Adaptive indicators** — feed `round(smoothPeriod)` or `round(smoothPeriod/2)` as the
lookback into RSI / stochastic / CCI. Note these need *variable-period* implementations;
off-the-shelf indicator libraries take a fixed integer, so hand-roll them.

---

## 4. Validation harness

Build these **before** pointing the pipeline at real data. Each has a measured threshold.

### Test 1 — Pure sine recovery (must pass first)

Input `100 + 0.05t + 3sin(2πt/20)`, 1500 bars.
**Pass:** median period ∈ [19.5, 20.5], sd < 1.0.
*Measured: median 19.98, mean 20.02, sd 0.21.*

Repeat at period 34. *Measured: median 34.17, sd 0.43.*

### Test 2 — Sine with noise

Same plus `N(0, 0.8)`.
**Pass:** median period ∈ [19, 23], sd < 3.0.
*Measured: median 20.81, sd 1.75.*

### Test 3 — Chirp tracking

Period sweeps linearly 12 → 40 bars.
**Pass:** correlation between estimate and true period > 0.95, mean error < 1 bar.
*Measured: corr 0.998, mean error −0.21 bars, p90 |error| 0.59 bars.*

### Test 4 — No-detrend regression guard

Run Stage 2 directly on undetrended price, skipping the roofing filter.
**Pass:** the test asserts the result is *broken*, locking in the requirement.
*Measured: period pinned at 50.00 against a true 20 — completely non-functional.*

### Test 5 — Random walk null (the important one)

Seeded GBM, no cycle present at all, 1500 bars, three seeds.
*Measured: median period 26.8–28.1, **sd 7.7–8.8**, wandering across 16–40 bars.*

A random walk containing zero cyclicality still produces a plausible-looking, continuously
varying "dominant cycle." This is the single most important result in this document.

**The discriminator is the standard deviation of the period estimate:**

| Input | period sd |
|---|---|
| genuine cycle | 0.2 – 1.8 |
| random walk (no cycle) | 7.7 – 8.8 |

So: compute period sd on a rolling window of your real ticker. If it sits near 8 rather
than near 1, the pipeline has found nothing and any signal you build on it is noise.
Make this a printed diagnostic on every real-data run, not a buried unit test.

### Test 6 — Repaint / look-ahead audit

For each bar `T`, recompute the FFT-based analytic signal using only `F[0..T]`, and compare
the newest value to what the full-history run reports for that same bar.

*Measured on the FFT method: **median 86% error at the live bar, p90 255%**.*

That is the size of the lie in a backtest built on a non-causal Hilbert transform. It is
the reason `hilbertFft.ts` lives in `validate/` and never in the live path. Keep it only to
(a) quantify this, and (b) act as an accuracy oracle for the causal version on
*historical, settled* bars.

---

## 5. Build order

1. `synthetic.ts` generators + `vitest` wired up.
2. `highpass.ts`, `supersmoother.ts`, `roofing.ts` — unit test DC gain and step response.
3. `hilbert.ts` + `analytic.ts` + `period.ts` — **stop and pass Tests 1–4** before continuing.
4. `hilbertFft.ts` and Test 6.
5. Test 5 (random walk null) and the rolling-sd diagnostic.
6. `yahoo.ts` real data; run the sd diagnostic and report honestly.
7. Only now: `snr.ts`, `trendMode.ts`, `trendline.ts`, `adaptive.ts`.
8. Charts last.

Do not let the assistant build indicators before Tests 1–5 pass. A pipeline that silently
pins to 50, or that "finds cycles" in noise, will look completely plausible on a price chart.

---

## 6. Streaming version (later)

Every filter here is already causal and carries at most 2–7 samples of state, so an online
form is mechanically simple: each module keeps a small ring buffer plus its recurrence
state and exposes `push(x): output`. Write the batch version first and make the streaming
version reproduce it bar-for-bar as a test. Do not start with streaming.

---

## 7. Expectation setting

The measured random-walk result is not a bug in this pipeline — it is a property of the
method. Persistent dominant cycles in liquid equities are weak to absent, and the machinery
will always report *some* period because the estimate is clamped to 6–50 and heavily
smoothed. This stack earns its keep as a **regime and volatility tool** — SNR gating,
trend-vs-cycle routing, adaptive lookbacks, low-lag trendlines — far more reliably than as
a market-timing oracle. Build it, but validate against the null before trusting any signal.

If pure denoising is the actual goal, the Super Smoother alone (Stage 1b) is a better
low-lag smoother than anything Hilbert-based, and needs none of the rest of this.

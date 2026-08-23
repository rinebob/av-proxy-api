# Syncfusion Chart Y-Axis Scaling Issue

## Problem

We're using Syncfusion EJ2 Angular Charts (`@syncfusion/ej2-angular-charts` v34.2.3) to render candlestick stock charts with a DateTime X-axis and zoom/scroll enabled.

**The Y-axis does not snap to the visible price data extents on initial load.** It renders the full historical price range (0 to max), compressing the candles into a thin band at the top of the chart. After manually dragging the scrollbar, the Y-axis correctly rescales to the visible window — but on initial load it does not.

## What We're Seeing

1. Chart loads with all data (e.g., 6,700 daily bars spanning 20+ years)
2. Initial zoom is applied programmatically via `primaryXAxis.zoomFactor` / `primaryXAxis.zoomPosition` to show the most recent ~90 bars
3. For a brief moment, the Y-axis appears correctly scaled to the visible bars
4. Then the chart's internal re-render fires and the Y-axis resets to the full data range (0 to ~$350 for AAPL)
5. Dragging the scrollbar afterward triggers a correct rescale

## Setup

- **Chart type:** Candlestick series on a DateTime X-axis
- **Zoom:** `mode: 'X'` (X-axis only), scrollbar enabled, mouse-wheel zoom, pinch zoom
- **Y-axis config:** `rangePadding: 'None'`, `enableAutoIntervalOnZooming: true`
- **Data:** Sorted oldest-to-newest, ~6,700 bars for daily interval
- **Initial zoom:** Set in the `(loaded)` event handler via `zoomFactor` / `zoomPosition` + `dataBind()`

## What We've Tried

### 1. `enableAutoIntervalOnZooming: true`
Already set. This adjusts the *interval* (tick spacing) on zoom but does not appear to rescale the *range* (min/max) to visible data.

### 2. Manually setting `primaryYAxis.minimum` / `maximum`
We computed the visible bar window from `zoomFactor`/`zoomPosition` and set `minimum`/`maximum` on the Y-axis. This works briefly but gets overwritten by the chart's internal re-render after the zoom is applied. Tried deferring with `setTimeout` — the re-render still wins.

### 3. `axisRangeCalculated` event
Syncfusion exposes an `axisRangeCalculated` event that fires during range calculation with mutable `minimum`/`maximum`/`interval` on the event args. We override these to the visible bar extents. This fires correctly and sets the values, but the chart still renders with the full range afterward — suggesting a subsequent internal calculation overrides our values, or the event fires before the zoom is applied.

### 4. `startFromZero: false`
Tried on the Y-axis. No observable effect on the range behavior.

## Questions for RS Team

Your charts render with correct Y-axis scaling on initial load with zoom applied. We'd like to know:

1. **How do you handle Y-axis range scaling on initial load with zoom?** Do you rely on a built-in Syncfusion feature, or do you manually compute and set the range?

2. **Which Syncfusion version are you on?** We're on v34.2.3 (just upgraded from v31.2.x).

3. **Do you use `axisRangeCalculated`?** If so, do you mutate `args.minimum`/`args.maximum`, and does it reliably stick through the full render cycle?

4. **How do you apply initial zoom?** Do you set `zoomFactor`/`zoomPosition` in the `(loaded)` event, via `[zoomSettings]` binding, or some other mechanism?

5. **Do you use `enableAutoIntervalOnZooming`?** Does it rescale the Y-axis *range* (not just interval) for you, or do you handle that separately?

6. **Are you using a StockChart instead of a regular Chart?** Syncfusion has a separate `StockChart` component that may handle this differently.

7. **Any specific Y-axis properties or chart configuration that makes zoom-aware range scaling work out of the box?**

## Relevant Code

Our chart configuration and initial zoom logic:

```typescript
// Y-axis config
public primaryYAxis: Object = {
  title: 'Price',
  labelFormat: '${value}',
  rangePadding: 'None',
  enableAutoIntervalOnZooming: true
};

// Zoom settings
public zoomSettings: ZoomSettingsModel = {
  enableMouseWheelZooming: true,
  enablePinchZooming: true,
  enableSelectionZooming: true,
  enablePan: true,
  enableScrollbar: true,
  mode: 'X'
};

// Initial zoom applied in (loaded) event
onChartLoaded(): void {
  const zoomFactor = initialPoints / data.length;      // e.g. 90/6700 = 0.013
  const zoomPosition = (data.length - initialPoints) / data.length;  // 0.987
  this.chart.primaryXAxis.zoomFactor = zoomFactor;
  this.chart.primaryXAxis.zoomPosition = zoomPosition;
  this.chart.dataBind();
}

// Y-axis range override via event
axisRangeCalculated(args: IAxisRangeCalculatedEventArgs): void {
  if (args.axis.name !== 'primaryYAxis') return;
  // Compute visible bars from zoom, set args.minimum/maximum
  args.minimum = visibleLow;
  args.maximum = visibleHigh;
}
```

```html
<ejs-chart
  [primaryXAxis]="primaryXAxis"
  [primaryYAxis]="primaryYAxis"
  [zoomSettings]="zoomSettings"
  (loaded)="onChartLoaded()"
  (axisRangeCalculated)="axisRangeCalculated($event)">
  <e-series-collection>
    <e-series type="Candle" [dataSource]="data"
              xName="t" high="h" low="l" open="o" close="c">
    </e-series>
  </e-series-collection>
</ejs-chart>
```

---

## Answers from RS Team (rel-str)

Below is what we do in `rel-str`. Two important caveats up front:

- **We are on an older Syncfusion line than you.** Our `package.json` pins `@syncfusion/ej2-angular-charts@^30.2.7` and `npm ls` resolves it to **30.2.7** (with `ej2-base@30.2.6`). You are on **v34.2.3**. I cannot confirm whether the range-reset behavior you describe is a regression introduced between v30 and v34, or whether it was always present and we just avoid triggering it. Worth verifying against the v34 changelog/release notes — I don't have a confirmed source for what changed in that window.
- **We do NOT use `axisRangeCalculated`, and we do NOT rely on any built-in zoom-aware Y-range feature.** Everything below is a manual workaround. If Syncfusion added a first-class "autoscale Y to visible range on zoom" flag in v31–v34, we are not using it and I cannot confirm it exists. Please check the current Syncfusion Charts API docs for `enableAutoIntervalOnZooming` semantics and any newer `rangePadding`/`autoScale` options before adopting our workaround.

### 1. How do we handle Y-axis range scaling on initial load with zoom?

**Manually.** We compute the visible bar slice from `zoomFactor`/`zoomPosition`, find the min low / max high over that slice, add ~3% padding, and imperatively set `primaryYAxis.minimum` / `primaryYAxis.maximum`, then call `chart.dataBind()`.

The critical sequencing detail: we set the X-axis `zoomFactor`/`zoomPosition` **and** the Y-axis `minimum`/`maximum` in the **same pass**, then issue a single `dataBind()`. We do not set X zoom first and let the chart re-render, then try to patch Y afterward — that two-step sequence is exactly what produces the "Y snaps to full range then stays there" symptom you are seeing, because Syncfusion's internal re-render after the X zoom recalculates Y against the full dataset and overwrites any Y values you set in a prior tick.

Reference implementation (older `rs-chart` component, DateTime X-axis):

```typescript
// Called from (loaded) handler AND from an Angular effect that watches chartData.
private applyInitialZoom(data: CandleWithRSColor[], timeframe: Timeframe | undefined): void {
  const chart = this.chart();
  if (!chart || !data || !data.length) return;

  // 1. Clamp X-axis domain to the data window (optional, but keeps scrollbar sane).
  const firstX = data[0].x;
  const lastX = data[data.length - 1].x;
  const paddingMs = 3 * 24 * 60 * 60 * 1000;
  const paddedMax = new Date((lastX as Date).getTime() + paddingMs);
  chart.primaryXAxis.minimum = firstX as any;
  chart.primaryXAxis.maximum = paddedMax as any;

  // 2. Compute visible window.
  const daysToShow = this.getInitialVisibleCount(timeframe);
  const visibleCount = Math.max(1, Math.min(daysToShow, data.length - 1));
  const zoomFactor = visibleCount / data.length;
  const zoomPosition = (data.length - visibleCount) / data.length;

  // 3. Set X zoom.
  chart.primaryXAxis.zoomFactor = zoomFactor;
  chart.primaryXAxis.zoomPosition = zoomPosition;

  // 4. Compute the explicit X range for Y scaling — SAME pass, no setTimeout.
  const minX = data[data.length - visibleCount].x as Date;
  const maxX = data[data.length - 1].x as Date;

  // 5. Set Y min/max from the visible slice and dataBind() once.
  autoscaleYAxisForRange(this.chartData(), [], chart, minX, maxX, /* refresh */ true);
}
```

Where `autoscaleYAxisForRange` is:

```typescript
export function autoscaleYAxisForRange(
  chartData, baselineData, chartComponent, minX, maxX, refresh = false
) {
  // filter bars to [minX, maxX], compute rawMin/rawMax from low/high,
  // pad by 3%, set chartComponent.primaryYAxis.minimum/maximum,
  // and if (refresh) chartComponent.dataBind();
  // Also short-circuits if min/max are already set to the same values
  // to avoid infinite re-render loops.
}
```

The "set X zoom + Y range together, single `dataBind()`" pattern is the load-bearing part. Your `axisRangeCalculated` approach fires **before** the zoom is applied (Syncfusion calculates axis ranges, then applies zoom), so when you mutate `args.minimum`/`args.maximum` you are computing against the **full** dataset's visible range, not the zoomed window — and a subsequent internal recalculation after zoom application overwrites your values. That matches your observed symptom exactly.

### 2. Which Syncfusion version are we on?

`@syncfusion/ej2-angular-charts@30.2.7`, `@syncfusion/ej2-charts@30.2.7`, `@syncfusion/ej2-base@30.2.6` (verified via `npm ls`). We have **not** upgraded to v34. I cannot confirm whether v34 changes the behavior of `axisRangeCalculated` or `enableAutoIntervalOnZooming` relative to v30.

### 3. Do we use `axisRangeCalculated`?

**No.** We evaluated it and it did not reliably stick through the full render cycle for the same reason you are hitting — it fires before zoom is applied, and a later internal range calculation overwrites the mutated `args.minimum`/`args.maximum`. We removed it and went with the imperative min/max + `dataBind()` approach described above.

### 4. How do we apply initial zoom?

Two mechanisms, both leading to the same `applyInitialZoom()` call:

1. **`(loaded)` event handler** — `onChartLoaded()` calls `applyInitialZoom()` on the first load only. We guard with an `isInitialLoad` signal so subsequent `loaded` fires (Syncfusion fires `loaded` multiple times) are ignored.
2. **Angular `effect()` watching `chartData()`** — fires when data arrives, calls `applyInitialZoom()`, then flips `isInitialLoad` to false. This catches the case where data arrives after the chart component is already mounted.

We do **not** bind `zoomFactor`/`zoomPosition` via `[primaryXAxis]` template binding for the initial zoom. Our newer `flex-chart` component explicitly comments why:

> `// NOTE: zoomFactor/zoomPosition are NOT included here — they are imperative state
> // applied once by applyInitialZoom(). Including them would cause Syncfusion to
> // reset the user's scroll position whenever this computed re-fires.`

So: set them imperatively in `(loaded)` / an effect, never as part of a reactive axis config that re-evaluates.

### 5. Do we use `enableAutoIntervalOnZooming`?

We do not rely on it for **range** scaling. Our reading matches yours: it adjusts tick **interval** (label density) on zoom, not the min/max **range**. We handle range ourselves in three places:

- **Initial load** — `applyInitialZoom()` (above).
- **`(scrollEnd)`** — recompute visible slice from `event.range.min`/`event.range.max`, call `autoscaleYAxisForRange(..., refresh=true)`.
- **`(zoomComplete)`** — same, using `event.currentVisibleRange.min`/`.max`.

```typescript
onZoomComplete(event: IZoomCompleteEventArgs): void {
  const chart = this.chart();
  if (!chart || !chart.primaryXAxis) return;
  if (event.currentVisibleRange) {
    const data = this.chartData();
    const min = toTimestamp(event.currentVisibleRange.min);
    const max = toTimestamp(event.currentVisibleRange.max);
    // optionally sync zoomFactor/zoomPosition back to the axis
    autoscaleYAxisForRange(this.chartData(), [], chart, min, max, true);
  }
}
```

### 6. Are we using a StockChart?

**No.** We use the regular `ejs-chart` (`ChartComponent`) with `ScrollBarService` + `ZoomService` injected. We have not evaluated `StockChart` for this use case, so I cannot confirm whether it handles zoom-aware Y-range out of the box. It is worth a spike on your side, but I don't want to assert it solves the problem without testing.

### 7. Specific config that makes this work

The properties that matter, in order of importance:

1. **Imperative Y min/max + single `dataBind()` in the same pass as X zoom** — this is the actual fix. Everything else is supporting structure.
2. **`rangePadding: 'None'`** (you already have this) — prevents Syncfusion from rounding the Y range outward and undoing your tight visible-window fit. Our `rs-chart` actually uses `rangePadding="Round"` on the series, but the Y-axis autoscale is done manually so the padding mode is mostly cosmetic.
3. **`zoomSettings.mode: 'X'`** (you have this) — keeps Y out of Syncfusion's zoom math.
4. **`enableAutoIntervalOnZooming`** — we don't depend on it for range; treat it as interval-only.
5. **Idempotency guards** — `isInitialLoad` signal + a `lastZoomKey` (`${initialZoomDays}-${interval}-${bars.length}`) so we don't re-apply initial zoom on indicator-only config changes, which would reset the user's scroll position.
6. **Short-circuit in `autoscaleYAxisForRange`** — if `primaryYAxis.minimum`/`maximum` already equal the computed values, skip the write and the `dataBind()`. This prevents re-render loops when `scrollEnd`/`zoomComplete` fire with the same range.

### Our newer architecture (for reference)

Our `flex-chart` component factors this into a `ChartLifecycleFacade` service with an Angular `effect` that watches a `ChartYAxisViewport` signal and writes it to the chart:

```typescript
effect(() => {
  const chart = this.chartSignal();
  const viewport = this.viewport.yAxisViewport();  // { valueType, min, max, zoomFactor?, zoomPosition? }
  if (!chart || !viewport) return;

  if (chart.primaryYAxis) {
    if (viewport.valueType === 'Double') {
      chart.primaryYAxis.minimum = viewport.min;
      chart.primaryYAxis.maximum = viewport.max;
    } else if (viewport.zoomFactor !== undefined && viewport.zoomPosition !== undefined) {
      // Logarithmic axis doesn't accept arbitrary min/max; we zoom the Y-axis instead.
      chart.primaryYAxis.zoomFactor = viewport.zoomFactor;
      chart.primaryYAxis.zoomPosition = viewport.zoomPosition;
    }
  }
  chart.animateSeries = false;
  chart.dataBind();
  this.refreshChartState();
});
```

The viewport is computed by a `ChartYAxisViewportController` using a pluggable scale strategy (`LinearScaleStrategy` / `LogarithmicScaleStrategy`), so the linear path sets `min`/`max` and the log path sets `zoomFactor`/`zoomPosition` on the Y-axis itself (because Syncfusion's built-in log axis snaps labels to powers of 10 and won't honor arbitrary min/max). The single-effect-writes-to-chart-once pattern is what keeps the Y range stable through Syncfusion's internal re-renders.

### TL;DR for your fix

Drop `axisRangeCalculated`. In your `(loaded)` handler, after setting `primaryXAxis.zoomFactor`/`zoomPosition`, compute the visible bar slice's min low / max high, set `primaryYAxis.minimum`/`maximum` to those values (±3% pad), and call `dataBind()` **once** — all in the same function, no `setTimeout`. Add the same recompute-and-set in `(scrollEnd)` and `(zoomComplete)` using the event's visible range. Guard the initial-load path with a flag so repeated `loaded` fires don't reset the user's scroll.

If that still doesn't stick on v34, the next thing to verify is whether v34 introduced a competing auto-range pass that runs after `(loaded)` — in which case the fix may need to move into a `setTimeout(() => { ... dataBind() }, 0)` deferred to after Syncfusion's post-load layout pass, or you may need to key the `<ejs-chart>` element (e.g. `[key]="symbol-interval-barsLength"`) so Syncfusion fully destroys and recreates the chart on dataset change rather than updating bindings in place. We do the latter in `flex-chart` (`chartKey` computed) specifically to avoid mid-initialization binding-update races. I have not confirmed either of these is necessary on v34 — flagging as worth verifying.

---

# Full Implementation Guide: Replicating the flex-chart Y-Axis Architecture

> **Status note:** This guide is derived from the actual `flex-chart` component in the rel-str codebase (Syncfusion `@syncfusion/ej2-angular-charts@30.2.7`). It is written for SA's team to replicate the Y-axis-scaling-on-zoom behavior. **I cannot confirm this exact code works unchanged on v34.2.3** — the API surface for `axisCollections`, `visibleRange`, `rect`, `dataBind()`, and `zoomFactor`/`zoomPosition` has been stable across v20–v30 in my experience, but I have not tested v34. Treat this as a blueprint to adapt, not a copy-paste solution. Verify each Syncfusion API against the v34 docs as you implement.

## Why a full architecture, not a snippet

The previous answer gave the "set X zoom + Y min/max in the same pass" recipe. If that didn't work for you on v34, the most likely reasons are:

1. **A reactive binding is re-firing after your imperative `dataBind()`** and resetting the Y-axis to auto-range. This happens if `primaryYAxis` is a computed/input that re-evaluates without `minimum`/`maximum` on it.
2. **Syncfusion v34 runs an internal auto-range pass after `(loaded)`** that overwrites imperative min/max set during `(loaded)`.
3. **The chart is not being destroyed/recreated on dataset change**, so a stale Y-axis from a prior render wins the race against your new imperative values.

The `flex-chart` architecture solves all three by separating **declarative axis config** (what Syncfusion owns) from **imperative viewport state** (what we own), gating imperative writes behind a single Angular `effect`, and keying the `<ejs-chart>` element so Syncfusion fully recreates on dataset change. Replicating the whole architecture is the reliable path; patching one event handler is not.

## Architecture overview

```
flex-chart/
├── flex-chart.component.ts        Shell: inputs, outputs, event handlers, DOM overlay
├── flex-chart.component.html      Template: keyed <ejs-chart> + series
├── flex-chart.types.ts            PriceBar, FlexChartDataset, FlexChartConfig, etc.
├── store/
│   └── chart-viewport.store.ts    NgRx SignalStore: crosshair + Y-axis viewport state
├── services/
│   ├── chart-instance.types.ts    Narrow typed wrapper over Syncfusion's untyped runtime
│   ├── chart-lifecycle-facade.service.ts   ALL imperative chart mutations live here
│   ├── chart-y-axis-viewport-controller.service.ts  Scale-strategy dispatch
│   └── chart-data-adapter.service.ts       bars → category-indexed series + panes
└── strategies/
    ├── scale-strategy.types.ts    ScaleStrategy interface
    ├── linear-scale.strategy.ts   Linear: sets min/max
    └── logarithmic-scale.strategy.ts  Log: sets zoomFactor/zoomPosition (log axis ignores min/max)
```

The four invariants that make Y-axis scaling work:

1. **`primaryYAxis` declarative config never includes `minimum`/`maximum`/`zoomFactor`/`zoomPosition`.** Those are imperative state. If they were in the computed, every re-evaluation would reset them.
2. **A single Angular `effect` writes the Y-axis viewport to the chart and calls `dataBind()`.** No other code path touches `primaryYAxis.minimum`/`maximum`.
3. **The viewport is computed from the visible bar slice**, not the full dataset, by a pluggable scale strategy.
4. **The `<ejs-chart>` element is keyed** (`[key]` or `@if` guard) so Syncfusion destroys and recreates it on dataset change, eliminating binding-update races.

## Step 0: Prerequisites

- Angular 17+ (uses `input()`, `output()`, `viewChild()`, `computed()`, `effect()`, `afterNextRender()`, `ChangeDetectionStrategy.OnPush`)
- `@ngrx/signals` for `signalStore` (or replace with a plain signal-based store)
- `@syncfusion/ej2-angular-charts` with `ChartModule`, `CandleSeriesService`, `ZoomService`, `ScrollBarService`, `LogarithmicService` (and any series types you use)

If you're not on Angular 17+ signals, the architecture still applies — translate `input()`/`computed()`/`effect()` to `@Input()`/getters/`ngOnChanges`. The Syncfusion interaction patterns are framework-agnostic.

## Step 1: Types — `flex-chart.types.ts`

Minimal types needed for the Y-axis fix. The full file has indicator/pane types; trim to what you need.

```typescript
export interface PriceBar {
  date: string;
  x: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface FlexChartDataset {
  symbol: string;
  interval: string;       // 'daily' | 'weekly' | 'monthly' | ...
  bars: PriceBar[];
}

export interface FlexChartConfig {
  initialZoomDays?: number;   // e.g. 90
  interval?: string;          // for axis label formatting
  logScale?: boolean;         // linear vs log Y-axis
  showZoomToolbar?: boolean;
  enableScrollbar?: boolean;
  indicators?: never[];       // omit for the minimal Y-axis fix
}
```

## Step 2: Typed Syncfusion instance wrapper — `chart-instance.types.ts`

Syncfusion's public typings don't expose `axisCollections`, `visibleRange`, `rect`, etc. This narrow interface lets the rest of the code avoid `any`. **Verify these property names still exist on v34** — they're runtime properties, not part of the declared API, so Syncfusion could rename them.

```typescript
export interface SfChartAxisRect { x: number; y: number; width: number; height: number; }
export interface SfChartVisibleRange { min: number; max: number; delta: number; }

export interface SfChartAxisLike {
  visibleRange?: SfChartVisibleRange;
  rect?: SfChartAxisRect;
  valueType?: 'Logarithmic' | 'Double';
  zoomFactor?: number;
  zoomPosition?: number;
  minimum?: number;
  maximum?: number;
}

export interface SfChartInstance {
  primaryXAxis?: SfChartAxisLike;
  primaryYAxis?: SfChartAxisLike;
  axisCollections?: SfChartAxisLike[];   // [xAxis, yAxis, ...lowerAxes]
  series?: { dataSource?: unknown[] }[];
  rows?: { height: string }[];
  animateSeries?: boolean;
  setProperties(props: Record<string, unknown>, muteOnChange?: boolean): void;
  dataBind(): void;
  refresh(): void;
}

export interface ChartAxisState {
  xAxis: Required<Pick<SfChartAxisLike, 'visibleRange' | 'rect'>>;
  yAxis: Required<Pick<SfChartAxisLike, 'visibleRange' | 'rect' | 'valueType'>>;
}

export interface SfAxisLabelRenderArgs {
  axis: { name: string; valueType?: 'Logarithmic' | 'Double' };
  value: unknown;
  text: string;
}
```

## Step 3: Y-axis viewport state — `chart-viewport.store.ts`

A per-component NgRx SignalStore holding the Y-axis viewport descriptor. The key type:

```typescript
export interface ChartYAxisViewport {
  valueType: 'Logarithmic' | 'Double';
  min: number;
  max: number;
  zoomFactor?: number;     // log mode only
  zoomPosition?: number;   // log mode only
}
```

If you don't use `@ngrx/signals`, replace with a plain `signal<ChartYAxisViewport | null>(null)` and a setter. The store also holds crosshair state (date, price, hovered flag) — include only what you need.

Full file: see rel-str `store/chart-viewport.store.ts`. The methods that matter for Y-axis are `setYAxisViewport(viewport)` and `resetViewport()`.

## Step 4: Scale strategies — `strategies/`

The strategy pattern keeps linear vs log branching out of the component. **This is the core of the Y-axis fix.**

### `scale-strategy.types.ts`

```typescript
import type { PriceBar } from '../flex-chart.types';
import type { ChartYAxisViewport } from '../store/chart-viewport.store';

export interface AxisRect { x: number; y: number; width: number; height: number; }
export interface VisibleRange { min: number; max: number; delta: number; }

export interface ScaleStrategy {
  readonly valueType: 'Logarithmic' | 'Double';
  readonly axisConfig: Record<string, unknown>;
  computeViewport(allBars: PriceBar[], visibleBars: PriceBar[]): ChartYAxisViewport;
  formatLabel(value: number): string;
  priceFromPixel(pixelY: number, yRect: AxisRect, range: VisibleRange): number;
  pixelFromPrice(price: number, yRect: AxisRect, range: VisibleRange): number;
}
```

### `linear-scale.strategy.ts` — **this is the fix for your problem**

```typescript
import type { PriceBar } from '../flex-chart.types';
import type { AxisRect, ScaleStrategy, VisibleRange } from './scale-strategy.types';
import type { ChartYAxisViewport } from '../store/chart-viewport.store';

export class LinearScaleStrategy implements ScaleStrategy {
  readonly valueType: 'Double' = 'Double';
  readonly axisConfig: Record<string, unknown> = {};
  private static readonly PAD_FACTOR = 0.03;

  computeViewport(_allBars: PriceBar[], visibleBars: PriceBar[]): ChartYAxisViewport {
    if (visibleBars.length === 0) {
      return { valueType: this.valueType, min: 0, max: 1 };
    }
    const rawMin = Math.min(...visibleBars.map(b => b.low));
    const rawMax = Math.max(...visibleBars.map(b => b.high));
    const pad = (rawMax - rawMin) * LinearScaleStrategy.PAD_FACTOR;
    return {
      valueType: this.valueType,
      min: Math.max(0, rawMin - pad),
      max: rawMax + pad,
    };
  }

  formatLabel(value: number): string {
    return `$${Math.round(value).toLocaleString('en-US')}`;
  }

  priceFromPixel(pixelY: number, yRect: AxisRect, range: VisibleRange): number {
    const ratio = pixelY / yRect.height;
    return range.max - ratio * range.delta;
  }

  pixelFromPrice(price: number, yRect: AxisRect, range: VisibleRange): number {
    const ratio = (range.max - price) / range.delta;
    return yRect.y + ratio * yRect.height;
  }
}
```

**Key point:** `computeViewport` takes `visibleBars` (the slice in the current zoom window), NOT `allBars`. The 3% padding gives breathing room without letting Syncfusion's auto-range take over.

### `logarithmic-scale.strategy.ts` (only if you need log scale)

Syncfusion's built-in log axis snaps labels to powers of 10 and **ignores arbitrary `minimum`/`maximum`**. So for log mode we keep the full-data auto-range and use `zoomFactor`/`zoomPosition` on the **Y-axis itself** to zoom to the visible log range. See rel-str file for the full implementation — if you're linear-only, skip this.

## Step 5: Y-axis viewport controller — `services/chart-y-axis-viewport-controller.service.ts`

Thin dispatcher that picks the active strategy and builds the declarative `primaryYAxis` config (without min/max — those come from the viewport signal imperatively).

```typescript
import { Injectable } from '@angular/core';
import type { PriceBar } from '../flex-chart.types';
import { ChartYAxisViewport } from '../store/chart-viewport.store';
import { AxisRect, LinearScaleStrategy, LogarithmicScaleStrategy, ScaleStrategy, VisibleRange } from '../strategies';

export interface PrimaryYAxisConfig {
  labelFormat: string;
  valueType: 'Logarithmic' | 'Double';
  opposedPosition: boolean;
  rowIndex: number;
  majorGridLines: { width: number };
  crosshairTooltip: { enable: boolean };
  minimum?: number;
  maximum?: number;
}

@Injectable()
export class ChartYAxisViewportController {
  private readonly linear = new LinearScaleStrategy();
  private readonly logarithmic = new LogarithmicScaleStrategy();

  private strategy(logScale: boolean): ScaleStrategy {
    return logScale ? this.logarithmic : this.linear;
  }

  computeViewport(logScale: boolean, allBars: PriceBar[], visibleBars: PriceBar[]): ChartYAxisViewport {
    return this.strategy(logScale).computeViewport(allBars, visibleBars);
  }

  buildAxisConfig(logScale: boolean, rowIndex: number): PrimaryYAxisConfig {
    const strategy = this.strategy(logScale);
    return {
      labelFormat: '{value}',
      valueType: strategy.valueType,
      opposedPosition: true,
      rowIndex,
      majorGridLines: { width: 1 },
      crosshairTooltip: { enable: false },
      ...strategy.axisConfig,
    } as PrimaryYAxisConfig;
  }

  formatLabel(logScale: boolean, value: number): string {
    return this.strategy(logScale).formatLabel(value);
  }

  priceFromPixel(logScale: boolean, pixelY: number, yRect: AxisRect, range: VisibleRange): number {
    return this.strategy(logScale).priceFromPixel(pixelY, yRect, range);
  }

  pixelFromPrice(logScale: boolean, price: number, yRect: AxisRect, range: VisibleRange): number {
    return this.strategy(logScale).pixelFromPrice(price, yRect, range);
  }
}
```

**Critical:** `buildAxisConfig` does NOT include `minimum`/`maximum` in the returned object (the `...strategy.axisConfig` spread for linear is `{}`). This is intentional — see Step 7.

## Step 6: Lifecycle facade — `services/chart-lifecycle-facade.service.ts`

**This is the single most important file.** Every imperative mutation of the Syncfusion chart instance lives here. The component never calls `chart.dataBind()` or sets `chart.primaryYAxis.minimum` directly.

```typescript
import { Injectable, Signal, effect, inject, signal, untracked } from '@angular/core';
import type { FlexChartConfig, FlexChartDataset, PriceBar } from '../flex-chart.types';
import { ChartViewportStore } from '../store/chart-viewport.store';
import { ChartYAxisViewportController } from './chart-y-axis-viewport-controller.service';
import type { ChartAxisState, SfChartInstance } from './chart-instance.types';

@Injectable()
export class ChartLifecycleFacade {
  private readonly viewport = inject(ChartViewportStore);
  private readonly yAxisController = inject(ChartYAxisViewportController);

  private chartSignal: Signal<SfChartInstance | null> = signal(null);
  private chartData: Signal<FlexChartDataset | null> = signal(null);
  private config: Signal<FlexChartConfig> = signal({});

  // Idempotency key — prevents re-applying initial zoom on indicator-only config changes.
  private readonly lastZoomKey = signal<string | null>(null);
  private readonly chartStateSignal = signal<ChartAxisState | null>(null);

  static readonly RIGHT_MARGIN_BARS = 5;
  readonly chartState: Signal<ChartAxisState | null> = this.chartStateSignal.asReadonly();

  connectAndActivate(
    chart: Signal<SfChartInstance | null>,
    chartData: Signal<FlexChartDataset | null>,
    config: Signal<FlexChartConfig>,
  ): void {
    this.chartSignal = chart;
    this.chartData = chartData;
    this.config = config;

    // (A) Apply initial zoom whenever chart becomes available or dataset changes.
    effect(() => {
      const chart = this.chartSignal();
      const data = this.chartData();
      const config = this.config();
      if (!chart || !data || data.bars.length === 0) return;

      const key = `${config.initialZoomDays ?? 0}-${config.interval ?? ''}-${data.bars.length}`;
      if (untracked(this.lastZoomKey) === key) return;
      this.lastZoomKey.set(key);

      this.applyInitialZoom();
      this.viewport.setLifecycle('ready');
    });

    // (B) THE Y-AXIS VIEWPORT EFFECT — single place that writes min/max to the chart.
    effect(() => {
      const chart = this.chartSignal();
      const viewport = this.viewport.yAxisViewport();
      if (!chart || !viewport) return;

      if (chart.primaryYAxis) {
        if (viewport.valueType === 'Double') {
          chart.primaryYAxis.minimum = viewport.min;
          chart.primaryYAxis.maximum = viewport.max;
        } else if (viewport.zoomFactor !== undefined && viewport.zoomPosition !== undefined) {
          // Log axis: zoom the Y-axis itself instead of setting min/max.
          chart.primaryYAxis.zoomFactor = viewport.zoomFactor;
          chart.primaryYAxis.zoomPosition = viewport.zoomPosition;
        }
      }

      chart.animateSeries = false;
      chart.dataBind();
      this.refreshChartState();
    });
  }

  /** Apply initial X-axis zoom and Y-axis range for the current dataset. */
  applyInitialZoom(): void {
    const chart = this.chartSignal();
    const data = this.chartData();
    const config = this.config();
    if (!chart || !data || data.bars.length === 0) return;

    const margin = ChartLifecycleFacade.RIGHT_MARGIN_BARS;
    const totalCategories = data.bars.length + margin;
    const initialDays = config.initialZoomDays ?? 60;
    const visibleCount = Math.max(1, Math.min(initialDays, data.bars.length - 1));
    const visibleRange = visibleCount + margin;
    const zoomFactor = visibleRange / totalCategories;
    const zoomPosition = (data.bars.length - visibleCount) / totalCategories;

    if (chart.primaryXAxis) {
      chart.primaryXAxis.minimum = 0;
      chart.primaryXAxis.maximum = data.bars.length - 1 + margin;
      chart.primaryXAxis.zoomFactor = zoomFactor;
      chart.primaryXAxis.zoomPosition = zoomPosition;
    }

    const visibleStart = Math.max(0, data.bars.length - visibleCount);
    const visibleBars = data.bars.slice(visibleStart);
    this.setYAxisViewport(data.bars, !!config.logScale, visibleBars);
  }

  /** Snap Y-axis to a visible range after zoom/scroll (index-based, for Category axis). */
  snapYAxisToVisibleRange(rangeMin: number, rangeMax: number): void {
    const data = this.chartData();
    if (!data || data.bars.length === 0) return;
    const minIdx = Math.max(0, Math.floor(rangeMin));
    const maxIdx = Math.min(data.bars.length - 1, Math.ceil(rangeMax));
    const visibleBars = data.bars.slice(minIdx, maxIdx + 1);
    const config = this.config();
    this.setYAxisViewport(data.bars, !!config.logScale, visibleBars);
  }

  /** Snap Y-axis to the chart's current X-axis visible range (reads from axisCollections). */
  snapYAxisToCurrentVisibleRange(): void {
    const chart = this.chartSignal();
    const data = this.chartData();
    if (!chart || !data || data.bars.length === 0) return;
    const xAxis = chart.axisCollections?.[0];
    if (!xAxis?.visibleRange) return;
    this.snapYAxisToVisibleRange(xAxis.visibleRange.min ?? 0, xAxis.visibleRange.max ?? 0);
    this.refreshChartState();
  }

  refresh(): void {
    const chart = this.chartSignal();
    if (!chart) return;
    chart.animateSeries = false;
    chart.refresh();
  }

  /** Capture axis rects/ranges from the Syncfusion instance for crosshair math. */
  refreshChartState(): void {
    const chart = this.chartSignal();
    if (!chart) { this.chartStateSignal.set(null); return; }
    if (chart.series?.length) {
      chart.animateSeries = false;
      try { chart.dataBind(); } catch { /* Syncfusion race during initial render */ }
    }
    const xAxis = chart.axisCollections?.[0];
    const yAxis = chart.primaryYAxis;
    if (!xAxis?.visibleRange || !xAxis?.rect || !yAxis?.visibleRange || !yAxis?.rect) {
      this.chartStateSignal.set(null);
      return;
    }
    this.chartStateSignal.set({
      xAxis: { visibleRange: xAxis.visibleRange, rect: xAxis.rect },
      yAxis: { visibleRange: yAxis.visibleRange, rect: yAxis.rect, valueType: yAxis.valueType ?? 'Double' },
    });
  }

  private setYAxisViewport(allBars: PriceBar[], logScale: boolean, visibleBars: PriceBar[]): void {
    if (allBars.length === 0) return;
    const viewport = this.yAxisController.computeViewport(logScale, allBars, visibleBars);
    this.viewport.setYAxisViewport(viewport);   // triggers effect (B)
  }
}
```

**Why this works where the inline approach doesn't:**

- Effect (A) sets X zoom AND calls `setYAxisViewport`, which updates the store signal.
- Effect (B) fires because the signal changed, writes `primaryYAxis.minimum`/`maximum`, and calls `dataBind()` — **after** Syncfusion has processed the X zoom from effect (A)'s `applyInitialZoom`.
- Because `primaryYAxis` declarative config (Step 7) has no `minimum`/`maximum`, no reactive re-evaluation can overwrite the imperative values.
- The `lastZoomKey` guard prevents effect (A) from re-firing on indicator-only config changes (which would reset the user's scroll position).

**If this still doesn't stick on v34:** the next experiment is to wrap the `chart.dataBind()` in effect (B) inside `setTimeout(() => { chart.dataBind(); this.refreshChartState(); }, 0)` to defer it past Syncfusion's post-load layout pass. I have not confirmed this is needed on v34 — flagging as worth trying.

## Step 7: The component shell — `flex-chart.component.ts`

The component is a thin shell. It owns inputs/outputs, event handlers, and DOM overlay elements. It delegates all chart mutation to the facade.

```typescript
import {
  Component, input, output, viewChild, effect, ChangeDetectionStrategy,
  computed, ElementRef, inject, NgZone, afterNextRender,
} from '@angular/core';
import {
  ChartModule, ChartComponent as SfChartComponent,
  CandleSeriesService, LineSeriesService, DateTimeService, CategoryService,
  ZoomService, ScrollBarService, LegendService, LogarithmicService,
  IZoomCompleteEventArgs,
} from '@syncfusion/ej2-angular-charts';

import type { FlexChartDataset, FlexChartConfig } from './flex-chart.types';
import { ChartViewportStore } from './store/chart-viewport.store';
import { ChartYAxisViewportController } from './services/chart-y-axis-viewport-controller.service';
import { ChartLifecycleFacade } from './services/chart-lifecycle-facade.service';
import type { SfChartInstance } from './services/chart-instance.types';

@Component({
  selector: 'app-flex-chart',
  standalone: true,
  imports: [ChartModule],
  providers: [
    ChartViewportStore,
    ChartYAxisViewportController,
    ChartLifecycleFacade,
    CandleSeriesService, LineSeriesService, DateTimeService, CategoryService,
    ZoomService, ScrollBarService, LegendService, LogarithmicService,
  ],
  templateUrl: './flex-chart.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FlexChartComponent {
  private readonly el = inject(ElementRef);
  private readonly zone = inject(NgZone);
  private readonly viewport = inject(ChartViewportStore);
  private readonly yAxisController = inject(ChartYAxisViewportController);
  private readonly lifecycleFacade = inject(ChartLifecycleFacade);

  private readonly chart = viewChild<SfChartComponent>('chart');

  // Narrow viewChild to typed runtime interface.
  private readonly typedChart = computed<SfChartInstance | null>(() => {
    const c = this.chart();
    return c ? (c as unknown as SfChartInstance) : null;
  });

  // Inputs
  chartData = input.required<FlexChartDataset | null>();
  config = input<FlexChartConfig>({});
  height = input<string>('400px');

  // Outputs (for cross-chart sync — omit if you don't need it)
  crosshairDateChange = output<Date | null>();
  crosshairPriceChange = output<number | null>();

  noAnimation = { enable: false };

  // --- DECLARATIVE AXIS CONFIGS (NO min/max/zoomFactor/zoomPosition here) ---

  // Category axis removes gaps between bars (TradingView-style).
  // Re-evaluates on dataset change so Syncfusion rebuilds for a new symbol.
  primaryXAxis = computed(() => {
    this.chartData()?.bars.length;   // dependency trigger
    return {
      valueType: 'Category' as const,
      majorGridLines: { width: 0 },
      edgeLabelPlacement: 'Shift' as const,
    };
  });

  // Y-axis declarative config. min/max applied imperatively by the facade.
  primaryYAxis = computed(() =>
    this.yAxisController.buildAxisConfig(!!this.config().logScale, 0),
  );

  // KEY: forces Syncfusion to destroy+recreate the chart on dataset change,
  // eliminating binding-update races during initialization.
  chartKey = computed(() => {
    const data = this.chartData();
    if (!data) return null;
    return `${data.symbol}-${data.interval}-${data.bars.length}`;
  });

  zoomSettings = computed(() => ({
    enableSelectionZooming: this.config().showZoomToolbar !== false,
    enableScrollbar: this.config().enableScrollbar !== false,
    enableMouseWheelZooming: false,
    mode: 'X' as const,
    enablePan: this.config().showZoomToolbar !== false,
  }));

  crosshair = { enable: false };  // we draw our own

  constructor() {
    // Connect facade to inputs — registers effects (A) and (B).
    this.lifecycleFacade.connectAndActivate(this.typedChart, this.chartData, this.config);

    // Reset viewport state when dataset changes.
    effect(() => {
      const data = this.chartData();
      if (data && data.bars.length > 0) {
        this.viewport.resetViewport();
      }
    });
  }

  onChartLoaded(): void {
    // Capture axis rects now that the chart has rendered — needed for crosshair.
    this.lifecycleFacade.refreshChartState();
  }

  onZoomComplete(event: IZoomCompleteEventArgs): void {
    if (!event.currentVisibleRange) return;
    this.lifecycleFacade.snapYAxisToVisibleRange(
      event.currentVisibleRange.min ?? 0,
      event.currentVisibleRange.max ?? 0,
    );
  }

  onScrollEnd(): void {
    this.lifecycleFacade.snapYAxisToCurrentVisibleRange();
  }

  // (Crosshair mouse handlers omitted — see full file if you need cross-chart sync.)
}
```

**The two lines that matter most for your Y-axis problem:**

1. `primaryYAxis = computed(() => this.yAxisController.buildAxisConfig(...))` — no `minimum`/`maximum` in the returned object.
2. `chartKey = computed(() => ...)` — used in the template to force chart recreation.

## Step 8: The template — `flex-chart.component.html`

The `@if (chartKey(); as key)` guard is what forces Syncfusion to destroy and recreate the chart. **Do not skip this.** Without it, Syncfusion receives binding updates on an existing instance and the Y-axis race you're seeing can occur.

```html
<div class="flex-chart-wrapper" [style.height]="height()">
  @if (chartKey(); as key) {
    @if (chartData(); as data) {
      @if (data.bars.length === 0) {
        <div class="no-data">No price data available</div>
      } @else {
        <ejs-chart
          [enableAnimation]="false"
          #chart
          [primaryXAxis]="primaryXAxis()"
          [primaryYAxis]="primaryYAxis()"
          [zoomSettings]="zoomSettings()"
          [crosshair]="crosshair"
          [legendSettings]="{ visible: false }"
          [height]="height()"
          [width]="'100%'"
          background="transparent"
          (loaded)="onChartLoaded()"
          (zoomComplete)="onZoomComplete($event)"
          (scrollEnd)="onScrollEnd()">

          <e-series-collection>
            <e-series
              [dataSource]="categoryBars()"
              type="Candle"
              xName="index"
              high="high"
              low="low"
              open="open"
              close="close"
              bearFillColor="#26a69a"
              bullFillColor="#ef5350"
              [enableSolidCandles]="true"
              [columnWidth]="1.0"
              [enableTooltip]="true"
              [animation]="noAnimation">
            </e-series>
          </e-series-collection>
        </ejs-chart>
      }
    } @else {
      <div class="no-data">Select a symbol to view chart</div>
    }
  }
</div>
```

**Note on `xName="index"`:** rel-str uses a Category X-axis with integer indices, not a DateTime X-axis. The bars are mapped to `{ index, open, high, low, close, ... }` in `ChartDataAdapter.categoryBars`. This avoids Syncfusion DateTime-axis gaps and lets zoom math use simple integer ranges. **If you want to keep your DateTime X-axis**, you'll need to adapt `applyInitialZoom` and `snapYAxisToVisibleRange` to use timestamp-based filtering instead of index slicing. The rel-str `rs-chart` component (older, DateTime-based) shows that pattern — see its `autoscaleYAxisForRange` in `chart.util.ts`.

## Step 9: Data adapter (Category-axis version) — minimal

If you adopt the Category-axis approach, you need to map bars to index-based points:

```typescript
import { computed, Injectable, signal, type Signal } from '@angular/core';
import type { FlexChartDataset, FlexChartConfig } from '../flex-chart.types';

@Injectable()
export class ChartDataAdapter {
  private chartData: Signal<FlexChartDataset | null> = signal(null);
  private config: Signal<FlexChartConfig> = signal({});

  connect(chartData: Signal<FlexChartDataset | null>, config: Signal<FlexChartConfig>): void {
    this.chartData = chartData;
    this.config = config;
  }

  categoryBars = computed(() => {
    const data = this.chartData();
    if (!data) return [];
    return data.bars.map((bar, index) => ({
      index,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      date: bar.x,
    }));
  });
}
```

Add this to the component's `providers` and `inject` it, then bind `[dataSource]="dataAdapter.categoryBars()"` in the template. The full rel-str adapter also computes indicator series, panes, and axes — include only what you need.

## Step 10: Wiring it all together

1. Add `ChartViewportStore`, `ChartYAxisViewportController`, `ChartLifecycleFacade`, `ChartDataAdapter` to the component's `providers` (so each chart instance gets its own).
2. In the constructor, call `this.lifecycleFacade.connectAndActivate(this.typedChart, this.chartData, this.config)` and `this.dataAdapter.connect(this.chartData, this.config)`.
3. Wire `(loaded)`, `(zoomComplete)`, `(scrollEnd)` to the component methods.
4. Feed `chartData` and `config` as signal inputs from the parent.

## Debugging checklist if it still doesn't work on v34

1. **Add a `console.log` inside effect (B)** (the Y-axis viewport effect). Confirm it fires after `applyInitialZoom`. If it doesn't fire, the `yAxisViewport` signal isn't being set — check `setYAxisViewport` is called.
2. **Log `chart.primaryYAxis.minimum`/`maximum` right after `dataBind()` in effect (B)**, then log again inside `onChartLoaded`. If the values are correct in (B) but wrong in `(loaded)`, Syncfusion is overwriting them post-load → you need the `setTimeout` deferral.
3. **Verify `chartKey` changes when the dataset changes.** If it doesn't, the chart isn't being recreated and stale state wins.
4. **Verify `primaryYAxis()` computed does NOT include `minimum`/`maximum`.** If it does, every CD cycle resets the Y-axis.
5. **Check `axisCollections[0].visibleRange`** exists after load. If v34 renamed `axisCollections` or `visibleRange`, the `snapYAxisToCurrentVisibleRange` path will silently no-op. This is the highest-risk v34 incompatibility — verify against v34 docs or runtime inspection.

## What to skip if you only need the Y-axis fix

- **Crosshair sync** (`ChartSyncOverlayComponent`, `syncCrosshairDate`/`syncCrosshairPrice` inputs, all the `onChartMouseMove`/`positionHoverCrosshair` code) — omit entirely.
- **Indicator panes** (`lowerPanes`, `chartAxes`, `chartRows`, `ComputedIndicatorSeries`, all `indicators/*.ts`) — omit; use a single candle series.
- **Log scale** — if you're linear-only, drop `LogarithmicScaleStrategy` and the `valueType` branching.
- **`ChartDataAdapter`** — only needed if you adopt the Category-axis approach. If you keep DateTime X-axis, you can compute visible bars by timestamp filter inline.

The irreducible minimum is: **types → viewport store → linear scale strategy → viewport controller → lifecycle facade → component shell with keyed `<ejs-chart>` and no min/max in declarative `primaryYAxis`.**

## Honest limitations of this guide

- **Not tested on v34.** I'm confident in the architecture and the v30 behavior. I'm not confident the `axisCollections`/`visibleRange`/`rect` runtime properties have identical shapes on v34. Verify before relying on them.
- **The `setTimeout` deferral is a hypothesis, not a confirmed fix.** If effect (B)'s `dataBind()` runs before Syncfusion's post-load auto-range pass on v34, deferring it past that pass is the logical next step — but I haven't reproduced the v34 issue.
- **The Category-axis approach is a bigger change** than just fixing Y-axis scaling. It's what makes rel-str's zoom math clean, but it requires reworking your data binding. If you want to keep DateTime X-axis, adapt `applyInitialZoom` to compute visible bars by timestamp range (see rel-str `rs-chart`'s `autoscaleYAxisForRange` for the pattern).
- **I have not reproduced your exact v34 symptom.** This guide is a faithful transcription of a working v30 architecture. If it doesn't resolve the v34 issue, the most productive next step is a minimal reproduction (single candle series, 100 bars, initial zoom to last 20) with logging at each lifecycle stage to pinpoint where Syncfusion overwrites the Y range.

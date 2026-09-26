**Topic:** Swing-driven options corpus platform  
**Topic Slug:** swing-driven-options-corpus  
**Thread:** Swing-set generation platform  
**Thread Slug:** swing-set-platform  
**Issue:** #113  
**Thread Parent:** #103  
**Topic Parent:** #102  
**Domain:** OPTIONS-DATA  
**Type:** Implementation Plan  
**Status:** Approved  
**Created:** 2026-09-23  
**Last Updated:** 2026-09-23  

---
> **SUPERSEDED (2026-09-26):** The multi-config + served-swing design in this document was replaced: SA stores one dev2/L2/R2 dates-only swing doc per enabled symbol — a corpus-internal date sampler, not a served artifact — and `partnerSwingSetsV2` was removed. See `102-107-DECISION-swing-doc-slim-shape.md`. This doc remains as the historical record of the shipped implementation.


# Implementation Plan — SHARED: ZigZag engine + swing-file types

- **SA** — SavantApi, this backend project.
- **ST** — SavantTrader, the consumer client application that calls SA endpoints and reads SA data.

## Goal

Port ST's ZigZag engine into SA's `shared/` package so both the SA backend and ST can compute identical swing files. The ported code must be pure TypeScript with no Angular dependencies.

## Approach

### 1. Port engine modules

Copy the following modules into `shared/zigzag/` and strip Angular imports:

- `st-zigzag.types.ts` → `shared/zigzag/zigzag.types.ts`
  - `ZigZagConfig`, `Pivot`, `ZigZagResult`, `Swing`, `SwingStats`, `DistributionSummary`, `Histogram`, `DirectionStats`, `PriceBar`
- `st-zigzag.utils.ts` → `shared/zigzag/zigzag.utils.ts`
  - `isFiniteNum`, `calcDev`
- `st-zigzag.pivots.ts` → `shared/zigzag/zigzag.pivots.ts`
  - `computeZigZagPivots`
- `st-zigzag.swings.ts` → `shared/zigzag/zigzag.swings.ts`
  - `deriveSwings`
- `st-zigzag.stats.ts` → `shared/zigzag/zigzag.stats.ts`
  - `computeSwingStats`

Replace `PriceBar` import from `flex-chart.types` with a local definition in `zigzag.types.ts`.

### 2. Port paramsId helper

Copy `deriveParamsId` from `rel-str/src/app/features/savant-trader/swing-analysis/swing-analysis.types.ts` into `shared/zigzag/swing-set.types.ts` (or a dedicated file) so SA can generate the same `{symbol}_{paramsId}` doc keys as ST.

### 3. Canonical config constants

Define the four canonical configurations in `shared/zigzag/canonical-configs.ts`:

```typescript
export const CANONICAL_ZIGZAG_CONFIGS: ZigZagConfig[] = [
  { devThreshold: 10, leftDepth: 10, rightDepth: 10, allowZigZagOnOneBar: true, projectionPivots: true, lineColor: '#1976d2', showTriggerDots: true },
  { devThreshold: 5,  leftDepth: 5,  rightDepth: 5,  allowZigZagOnOneBar: true, projectionPivots: true, lineColor: '#1976d2', showTriggerDots: true },
  { devThreshold: 3,  leftDepth: 3,  rightDepth: 3,  allowZigZagOnOneBar: true, projectionPivots: true, lineColor: '#1976d2', showTriggerDots: true },
  { devThreshold: 2,  leftDepth: 2,  rightDepth: 2,  allowZigZagOnOneBar: true, projectionPivots: true, lineColor: '#1976d2', showTriggerDots: true },
];
```

### 4. Swing-file document type

Define the persisted document shape in `shared/zigzag/swing-set.types.ts`:

```typescript
export interface SwingSetDoc {
  symbol: string;
  paramsId: string;
  config: ZigZagConfig;
  pivots: Pivot[];
  projection?: Pivot | null;
  swings: Swing[];
  stats: SwingStats;
  generatedAt: TimestampLike;
  source: 'sa' | 'st';
}
```

This matches ST's `SwingAnalysisDoc`/`SwingAnalysisInput` shape with an added `source` field to distinguish SA-generated files.

### 5. Price-bar adapter type

SA's daily-adjusted store uses a different shape than ST's `PriceBar`. Define a thin adapter type in `shared/zigzag/swing-set.types.ts` that the BE service maps into `PriceBar` before calling the engine:

```typescript
export interface DailyAdjustedBar {
  date: string;      // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  adjustedClose: number;
  volume: number;
  dividendAmount: number;
  splitCoefficient: number;
}
```

The adapter maps `adjustedClose` to `close` and `date` to `x`/`date` fields used by `PriceBar`.

## Module layout

```text
shared/zigzag/
├── zigzag.types.ts          # types + PriceBar
├── zigzag.utils.ts          # math helpers
├── zigzag.pivots.ts         # computeZigZagPivots
├── zigzag.swings.ts         # deriveSwings
├── zigzag.stats.ts          # computeSwingStats
├── swing-set.types.ts       # SwingSetDoc, deriveParamsId, DailyAdjustedBar
├── canonical-configs.ts     # CANONICAL_ZIGZAG_CONFIGS
└── index.ts                 # public exports
```

## Dependencies

- No new npm dependencies. The engine is pure math.
- `shared/` builds with the existing `npm run build` under `shared/`.

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Porting introduces subtle behavioral differences | Write unit tests that compare SA output to ST output for the same symbol/date range |
| `PriceBar` shape mismatch | Keep the adapter layer thin and centralized; add compile-time type tests |
| Canonical config drift between ST and SA | Define canonical configs once in `shared/`; both projects import them |

## Open questions

- Should the ported engine live in `shared/zigzag/` or `shared/indicators/`? `shared/zigzag/` is preferred for clarity.
- Does ST need to import the shared package too, or only read SA-generated swing files? Initially ST only reads files; sharing the package is optional later.

## Acceptance criteria

- [ ] All engine modules are copied into `shared/zigzag/` and compile.
- [ ] `deriveParamsId` produces identical output for the four canonical configs.
- [ ] `CANONICAL_ZIGZAG_CONFIGS` matches the four documented configs.
- [ ] `SwingSetDoc` type is defined and serializable to Firestore.
- [ ] `DailyAdjustedBar` adapter type is defined.
- [ ] `shared/index.ts` (or equivalent) exports the zigzag module.

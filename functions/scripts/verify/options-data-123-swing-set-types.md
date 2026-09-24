# Verification Guide — Task #123: Swing-set types, paramsId, canonical configs

Topic: #102 (Swing-driven options corpus) · Thread: #103 (Swing-set generation platform) · Blueprint: #120 (SHARED)

## What this verifies

Task #123 added `SwingSetDoc`, `deriveParamsId`, `CANONICAL_ZIGZAG_CONFIGS`, and `DailyAdjustedBar` to `shared/zigzag/`. This script confirms the **compiled** shared package exports them correctly and that a `SwingSetDoc` assembles end-to-end from real prod daily bars — the exact seam `SwingSetGenerationService` (#125) will implement.

## Scripts

| Script | Pipeline stage | What it checks |
|---|---|---|
| `options-data-123-swing-set-types.ts` | Transform + doc assembly | `CANONICAL_ZIGZAG_CONFIGS` = 10/10/10, 5/5/5, 3/3/3, 2/2/2; `deriveParamsId` produces the exact ST-compatible ids (`dev{N}_L{N}_R{N}_1barY_projY`), deterministic, distinct; a `SwingSetDoc` assembled from prod bars has consistent paramsId, swings count, stats counts, and `source='sa'` |

## Usage

```bash
cd functions
npm run copy-shared   # required if shared/ changed since last build
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-123-swing-set-types.ts [SYMBOL]
```

- `SYMBOL` (optional, positional) — tracked symbol with daily-adjusted data. Default: `AAPL`.

## Passing result

Every check prints `PASS: ...`, a per-config line shows the doc key (`→ dev5_L5_R5_1barY_projY: 492 pivots, 491 swings, docKey=AAPL_dev5_L5_R5_1barY_projY`), and the script ends with:

```
=== All verification checks passed ===
```

Exit code 0.

## Failing result

Prints `FAIL: {description}` and exits 1. Common causes:

- `@shared/zigzag` doesn't resolve → run `npm run copy-shared` first.
- paramsId mismatches → `deriveParamsId` diverged from ST's format — check `rel-str/src/app/features/savant-trader/swing-analysis/swing-analysis.types.ts`.
- Symbol has no daily-adjusted data → pick another tracked symbol.

## Setup/teardown

Read-only against prod Firestore (project `alpha-vantage-proxy-api`). Requires application-default credentials with Firestore read access. No data is created or modified.

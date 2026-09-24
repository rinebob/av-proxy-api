# Verification Guide — Task #124: Swing-set data layer

Topic: #102 (Swing-driven options corpus) · Thread: #103 (Swing-set generation platform) · Blueprint: #121 (BE)

## What this verifies

Task #124 added `DailyAdjustedReader` and `SwingSetRepository` under `functions/src/v2/swing-set/`. This script exercises both against prod Firestore — the reader against real daily-adjusted bars, the repository via a temporary probe doc.

## Scripts

| Script | Pipeline stage | What it checks |
|---|---|---|
| `options-data-124-swing-set-data-layer.ts` | Ingestion (reader) + Persistence (repo) | `read()` returns ascending `DailyAdjustedBar[]` with finite `adjustedClose`; `toPriceBar` maps `adjustedClose`→`close` and `date`→`x`; `upsert` writes `options-swing-sets/{symbol}_{paramsId}`; `get`/`listBySymbol`/`listConfirmedPivots`/`getCurrentSwing` return the probe doc correctly; missing docs return `null` |

## Usage

```bash
cd functions
npm run copy-shared   # required if shared/ changed since last build
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-124-swing-set-data-layer.ts [SYMBOL]
```

- `SYMBOL` (optional, positional) — tracked symbol used as the reader source. Default: `AAPL`.
- The repository probe always writes `options-swing-sets/ZZTEST_dev5_L5_R5_1barY_projY` and deletes it in a `finally` block (setup/teardown built in). If the script is killed mid-run, delete that doc manually.

## Passing result

Every check prints `PASS: ...`, `cleanup: deleted ...`, and ends with `=== All verification checks passed ===` (exit 0).

## Failing result

Prints `FAIL: {description}` and exits 1. Common causes:

- `@shared/zigzag` doesn't resolve → run `npm run copy-shared`.
- Reader returns 0 bars → the symbol has no daily-adjusted year docs.
- Repository checks fail → verify `options-swing-sets` collection permissions and the `{symbol}_{paramsId}` doc-key logic.

## Setup/teardown

Writes exactly one temporary `ZZTEST_*` doc to prod `options-swing-sets` and deletes it on exit (success or failure). Requires credentials with Firestore read+write.

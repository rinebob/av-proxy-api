# Verification Guide — Task #125: Swing-set generation service

Topic: #102 (Swing-driven options corpus) · Thread: #103 (Swing-set generation platform) · Blueprint: #121 (BE)

## What this verifies

`SwingSetGenerationService` end-to-end against prod: `DailyAdjustedReader` → shared zigzag engine → `SwingSetRepository.upsert` — the real path `generateSwingSetsTask` (#126) and the sweep (#127) will call.

## Scripts

| Script | Pipeline stage | What it checks |
|---|---|---|
| `options-data-125-swing-set-generation.ts` | Generation (transform + persistence) | `generateForSymbol` writes all four canonical docs keyed `{symbol}_{paramsId}`; each doc carries `source='sa'`, engine-computed pivots/swings/stats with consistent counts, `generatedAt` set; re-generation is idempotent (identical payload except `generatedAt`, no duplicate docs) |

## Usage

```bash
cd functions
npm run copy-shared   # required if shared/ changed since last build
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-125-swing-set-generation.ts [SYMBOL]
```

- `SYMBOL` (optional, positional) — tracked symbol with daily-adjusted data. Default: `AAPL`.

## Passing result

Per-config `PASS` lines plus a summary (`→ AAPL_dev5_L5_R5_1barY_projY: 495 pivots, 494 swings`), idempotency + dedup checks, `cleanup: deleted 4 {SYMBOL} docs`, ending with `=== All verification checks passed ===` (exit 0).

## Failing result

Prints `FAIL: {description}` and exits 1. Cleanup still runs via `finally`. If the script is killed mid-run, delete `options-swing-sets/{SYMBOL}_*` docs manually.

## Setup/teardown

**Mutating** — writes the four `{SYMBOL}_{paramsId}` docs to prod `options-swing-sets`, then deletes them in a `finally` block. **Aborts before writing if the symbol already has swing-set docs** (running it against real generated data would overwrite then destroy it — use a symbol with no existing sets, or delete them first). Not in `run-all`. Requires Firestore read+write credentials.

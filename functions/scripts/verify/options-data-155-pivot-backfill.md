# Verification Guide — Task #155: pivot-driven backfill (`dateSource: 'pivots'`)

Topic: #102 (Swing-driven options corpus) · Thread: #106 (Options corpus ingest) · Blueprint: #149 (BE)

## What this verifies

`triggerHistoricalOptionsPilot` in `pivots` mode plans each enabled symbol's corpus dates from its swing doc (not the trading calendar), diffs vs GCS coverage, reports per-symbol `planned/present/missing/enqueued`, and — on execute — dispatches seed tasks carrying the pivot `kind` stamp.

## Scripts

| Script | Pipeline stage | What it checks |
|---|---|---|
| `options-data-155-pivot-backfill.ts` | Pivot backfill dry-run | per-symbol report shape, totals = Σ per-symbol, manifest ⊆ enabled set, subset honoring (non-enabled symbol dropped), zero writes/dispatch in dryRun |

## Usage

```bash
cd functions
$env:OPTIONS_CORPUS_BUCKET="av-hist-options-corpus-bucket"
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-155-pivot-backfill.ts
```

**Read-only** — dryRun persists no run plan and enqueues no tasks. Prints the per-symbol plan table; symbols without a corpus swing doc show `planned=0` (listed, not failed — normal pre-generation state).

## Passing result

All `PASS` lines, `=== All verification checks passed ===` (exit 0). The `missing=` totals are the real AV-call estimate for the eventual execute run — that IS the dryRun cost preview.

## Failing result

`FAIL: {description}` exit 1.

## Endpoint contract (new)

`POST triggerHistoricalOptionsPilot` — same body plus:

- `dateSource: 'pivots'` (default `'calendar'`) — pivot mode ignores `startDate`/`maxTradingDatesPerSymbol`
- `dryRun: true` → report only, zero writes; `execute: true` + `dryRun: false` → persists run plan, dispatches `kind`-stamped seed tasks for missing items only

Report gains `dateSource` and `perSymbol: [{symbol, planned, present, missing, enqueued, error?}]`.

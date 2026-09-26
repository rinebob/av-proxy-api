# Task #168 — Symbol-metrics contract types

## What this verifies

The compiled `@shared/options` package exposes the symbol-metrics contract:
path constants (`symbol-metrics` / `years`), `SYMBOL_METRIC_FIELDS` whitelist
(`iv30`, `iv30Method`, `iv30Contracts`), and that a `SymbolMetricsYearDoc` +
`IvMetricsRow` assemble and survive JSON round-trip.

## Scripts

| Script | Pipeline stage | What it checks |
|---|---|---|
| `options-data-168-symbol-metric-types.ts` | Shared contract (transform) | Constant values, field whitelist, doc/row assembly + serialization |

## Usage

```
cd functions
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json \
  scripts/verify/options-data-168-symbol-metric-types.ts
```

## Passing result

Six `PASS` lines then `=== All verification checks passed ===` (exit 0).

## Failing result

`FAIL: <check>` then exit 1 — the compiled package is stale or the contract
drifted; rebuild with `npm run copy-shared` (or `npm run build`).

## Setup/teardown

Read-only — no writes, no credentials. Requires `npm run copy-shared` to have
run since the last `shared/` edit.

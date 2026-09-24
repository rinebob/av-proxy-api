# Verification Guide: Task #99 — companyInfo marketCap/beta backfill

## Script under test

`functions/scripts/backfill/backfill-companyinfo-numbers.ts` — one-time, idempotent migration.
Reads `symbol-data/{SYM}/company-overview/av-company-overview` for every tracked symbol,
builds the canonical `companyInfo` subset via `buildTrackedSymbolCompanyInfo`, diffs against
the stored doc via `diffCompanyInfoForWrite`, and `update()`s only the changed dotted fields.
Zero Alpha Vantage calls — stored data only.

**This is a mutating script, not a read-only verify script** — it is deliberately *not* wired
into `run-all.ts`. Re-verification = run with `--dry-run` (expects 0 writes after the initial
run) + re-run `symbol-manager-98-sortable-fields.ts`.

## Usage

```bash
# From functions/
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/backfill/backfill-companyinfo-numbers.ts [--dry-run] [--symbols A,MSFT]
```

| Flag | Effect |
|---|---|
| `--dry-run` | Report intended writes per symbol; touch nothing |
| `--symbols X,Y` | Restrict to a comma-separated subset |

## Expected results

**Passing first run:** `Written: ~875`, `Already current: 1` (NVDA, written by the #97 verify
script), `No overview doc: ~48` (ETFs/indexes — expected), `Errors: 0`.

**Passing re-run (idempotency):** `Written: 0`, `Already current: ~876`.

**Downstream check:** `symbol-manager-98-sortable-fields.ts` — after the backfill,
`marketCap desc` returns a full page of numerically ordered docs and `total` reflects the
filtered count (~876), not the active-doc count.

## Observed (2026-09-23, prod)

- Dry-run: 924 tracked → 875 would write, 48 no-overview (all ETFs), 0 errors
- Real run: 875 written, 0 errors
- Re-run: 0 written, 876 already current — idempotent
- #98 verify script: 10/10 — marketCap desc numerically ordered across the full set

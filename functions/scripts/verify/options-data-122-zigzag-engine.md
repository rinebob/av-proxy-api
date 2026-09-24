# Verification Guide — Task #122: ZigZag engine port into shared/zigzag

Topic: #102 (Swing-driven options corpus) · Thread: #103 (Swing-set generation platform) · Blueprint: #120 (SHARED)

## What this verifies

The SA ZigZag engine was ported from rel-str (`st-zigzag.*.ts`) into `shared/zigzag/`. This script confirms the **compiled** shared package (`shared/lib/zigzag`) exports the engine API and produces correct, internally-consistent results when run against real prod daily-adjusted bars — the same input the swing-set generation service will feed it.

## Scripts

| Script | Pipeline stage | What it checks |
|---|---|---|
| `options-data-122-zigzag-engine.ts` | Transform (engine computation on real data) | Compiled exports resolve; `computeZigZagPivots` produces confirmed, alternating, time-ordered pivots; `deriveSwings` count and confirmation flags are consistent with pivots+projection; `computeSwingStats` direction counts match confirmed swings; non-default configs (10/10/10, 2/2/2) run cleanly; last pivot maps back to a real bar date |

## Usage

```bash
cd functions
npm run copy-shared   # required if shared/ changed since last build
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-122-zigzag-engine.ts [SYMBOL]
```

- `SYMBOL` (optional, positional) — tracked symbol with daily-adjusted data. Default: `AAPL`.

## Passing result

Every check prints `PASS: ...`, a per-config pivot count line (`→ 5/5/5: 492 pivots`), and the script ends with:

```
=== All verification checks passed ===
```

Exit code 0.

## Failing result

Prints `FAIL: {description}` and exits 1. Common causes:

- `@shared/zigzag` doesn't resolve → run `npm run copy-shared` first.
- `years has 0 year docs` → the symbol has no daily-adjusted data in `symbol-data/{SYMBOL}/sa-time-series/av-daily-adjusted/years`.
- Pivot-order/alternation failures → engine regression; compare against `functions/tests/shared/zigzag/*` unit tests.

## Setup/teardown

Read-only against prod Firestore (project `alpha-vantage-proxy-api`). Requires application-default credentials with Firestore read access. No data is created or modified.

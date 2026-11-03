# Verify: options-data-227-chain-sanity-flags

**Task:** #227 — Chain sanity flags
**Type:** Read-only by default; `--stamp-flags` writes `chainFlag` custom
metadata on existing GCS corpus objects (payloads untouched).
**Not** part of `run-all.ts` — needs `GCLOUD_PROJECT` + ADC + real GCS
downloads (~1s/object; bound to the reconcile window unless `--full`).

## What it exercises

The chain-sanity pipeline end-to-end against prod:

1. **Ref census** — `gcs.listItems` projects `chainFlag`/`chainFlagConfirmed`
   off real object custom metadata for the requested symbols.
2. **Recount drift** — downloads every stored object in the reconcile
   window (`OPTIONS_CORPUS_DAILY_FLOOR_DATE .. yesterday ET`), recomputes
   the flag via `chainSanityCounts`, and diffs against stamped metadata —
   catches both unstamped suspects (pre-flagging-code objects) and stale
   stamps.
3. **Reconcile dry-run** — the real `runCorpusReconcile` core with
   production read deps and recording write/dispatch stubs: unconfirmed
   flagged objects in-window must surface as `forceRefetch` dispatches;
   `chainFlagConfirmed` ones must appear only as thin-chain counts/logs.
4. **Run-item fields** — `listItemsForSymbol` shows `putCount`/`callCount`/
   `rowCount`/`chainFlag` on seed outcomes (populated only by seeds that
   ran the flagging worker code — informational pre-deploy).

## Run it

```
cd functions
# dry (read-only) — recount + reconcile dry-run on QQQ:
GCLOUD_PROJECT=alpha-vantage-proxy-api npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-227-chain-sanity-flags.ts

# bound to other symbols:
GCLOUD_PROJECT=alpha-vantage-proxy-api npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-227-chain-sanity-flags.ts --symbols QQQ,SNDK

# stamp recounted flags onto drifting objects (MUTATING — object metadata):
GCLOUD_PROJECT=alpha-vantage-proxy-api npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-227-chain-sanity-flags.ts --stamp-flags [--symbols …]
```

| Flag | Effect |
|---|---|
| `--symbols A,B` | Bound the scan (default `QQQ`; gated by the live `optionsEnabled` list in the reconcile pass) |
| `--full` | Recount every stored object incl. pre-2026 pivot corpus outside the window (~10x slower) |
| `--stamp-flags` | Call `gcs.setChainFlag` for each object whose recounted flag differs from stamped metadata — the backfill path for objects stored before the flagging code existed |

## Pass criteria

- Exits 0 with `=== All verification checks passed ===`.
- `every flagged suspect dispatches with forceRefetch — N/N` PASS.
- `synthetic unconfirmed suspect dispatched with forceRefetch` PASS —
  the dry-run injects one flagged + one confirmed probe ref on the first
  symbol so the dispatch assertions prove the path even when prod has no
  stamped suspects (nothing is written — probes ride the recording stubs).
  Probes are bounded to trading days; a FAIL showing `no probe date` means
  re-run with a different `--symbols` — an environment condition, not a
  regression.
- `synthetic confirmed flag counted as thin-chain, not re-seeded` PASS.
- `forceRefetch payloads are well-formed seed tasks` PASS.
- Drift lines are **advisory**, not failures — unstamped objects are the
  expected pre-deploy state; `--stamp-flags` is the deliberate repair.

## Verified baseline (2026-11-01)

- Dry on QQQ: **1,966 objects; 209 in-window recounted (0 corrupt);
  drift = 4 — all `calls_only`** (`2026-08-27`, `2026-09-09`,
  `2026-09-25`, `2026-10-12` — the ~5,800-call/0-put anomaly observed in
  the wild). Unstamped suspects still count as present — exactly why the
  stamp pass exists.
- Reconcile dry-run (with probes): `gaps=0 enqueued=1 flagged=1
  thinChains=1` — probe `2026-01-02` dispatched `forceRefetch`; probe
  `2026-01-05` logged `thin-chain … empty — upstream-confirmed`.
- Run items: 1,310 scanned, `withCounts=0` — counts land on seed outcomes
  only after the flagging worker deploys.

## Residue

- Dry mode: none.
- `--stamp-flags` sets `chainFlag` (and clears none) on object custom
  metadata — a metadata-only write; payloads stay immutable
  (`ifGenerationMatch: 0`). Stale stamps on healthy payloads are reported,
  not auto-cleared, and left for triage.

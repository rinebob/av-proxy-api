# Verify — Task #138: OptionableProbeService

Verifies the probe seam end-to-end against prod: `probe()` returns optionable +
summary (incl. `expirations`), `probeAndPersist()` writes the flag fields and
applies the §76 defaults without clobbering an existing `optionsEnabled`, and
`isQuotaError` is exported for callers' abort decisions.

## Run

```powershell
cd functions
$env:ALPHAVANTAGE_API_KEY = (gcloud secrets versions access latest --secret=ALPHAVANTAGE_API_KEY --project=alpha-vantage-proxy-api)
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-138-optionable-probe.ts [SYMBOL]
```

Default symbol `AAPL` (already probed — rewrites equivalent values).

## Setup/teardown

**Mutating but idempotent** — rewrites `optionable`/`optionableCheckedAt`/
`optionableProbeSummary` on an existing tracked doc with equivalent values.
Use a symbol that's already probed (default AAPL) so nothing material changes.
Not in `run-all`. Requires Firestore read+write + `ALPHAVANTAGE_API_KEY`.

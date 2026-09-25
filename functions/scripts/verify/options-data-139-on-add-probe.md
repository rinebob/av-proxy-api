# Verify — Task #139: Ingestion defaults + on-add optionable probe

Verifies `withOptionsFlagDefaults` (new doc gets `optionsEnabled=false` +
empty `optionsEnabledHistory`; existing values preserved) and
`handleSymbolReadyTransition` gates against prod: no-transition skip,
already-probed skip, and a real unprobed `→READY` transition running the
probe end-to-end.

## Run

```powershell
cd functions
$env:ALPHAVANTAGE_API_KEY = (gcloud secrets versions access latest --secret=ALPHAVANTAGE_API_KEY --project=alpha-vantage-proxy-api)
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-139-on-add-probe.ts [SYMBOL]
```

Default symbol `AAPL` (already probed — the 'probed' leg rewrites equivalent values).

## Setup/teardown

**Mutating but idempotent** — the unprobed-transition leg runs a real
`probeAndPersist`, rewriting `optionable`/`optionableCheckedAt`/
`optionableProbeSummary` on an existing doc with equivalent values. Use an
already-probed symbol so nothing material changes. Not in `run-all`.
Requires Firestore read+write + `ALPHAVANTAGE_API_KEY`.

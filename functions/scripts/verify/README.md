# Verification Scripts

Scripts that verify task implementations against the real environment. These are **not** part of the test suite — they are run manually on-demand and hit real systems (prod Firestore, prod APIs), not mocks or emulators.

## Why verification scripts exist

Unit tests verify behavior with mocked dependencies. They confirm the code does what we expect *given certain inputs*. But they don't confirm the code actually works when run for real — that the imports resolve, the types compile, the Firestore paths are correct, the API responses match the expected shape, and the pipeline stages connect end-to-end.

Verification scripts close that gap. Each script targets a **distinct part of the pipeline** a task touches (ingestion, transform, persistence, API response, external integration) and confirms it works against the real environment. A task is not done until every pipeline stage it touches has a passing verification script.

This project has a single environment (no dev/staging — see README.md), so these scripts hit prod directly. They must stay deliberate, on-demand invocations — never wired into CI or `npm test`.

## How to run them

### Prerequisites

Build the shared package first if it has changed since the last build:

```bash
cd functions
npm run copy-shared
```

This compiles `shared/` and copies the output to `functions/lib/shared/` so the `@shared/*` path alias resolves at runtime.

### Run a single script

```bash
cd functions
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/{script-name}.ts
```

The `-r tsconfig-paths/register` flag resolves the `@shared/*` and `../src/*` path aliases at runtime. The `-P scripts/tsconfig.json` flag uses the scripts tsconfig which has the correct path mappings for script execution.

### Run all scripts

```bash
cd functions
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/run-all.ts
```

This runs every verification script in dependency order and reports a pass/fail summary. Use this to re-verify the full pipeline after changes that span multiple tasks.

### What a passing result looks like

Each script prints `PASS: {description}` for each check and ends with:

```
=== All verification checks passed ===
```

The run-all script prints a summary:

```
========== Summary ==========
Passed: N/N
Failed: 0/N
```

### What a failing result looks like

A failing script prints `FAIL: {description}` and exits with code 1. The run-all script continues to the next script and reports the failure in the summary.

Treat a failing verification script like a failing test — fix the code (or the script if its expectations were wrong) and re-run until it passes.

## What they verify

Each script targets a specific pipeline stage for a specific task. The table below maps scripts to tasks and pipeline stages.

### SHARED area (types, config, enums)

SHARED verification scripts confirm that the shared package exports the correct types, enums, and config at runtime. They import from `@shared/alpha-vantage` (the compiled barrel export) and assert that:

- Enums have the expected values
- Mapping objects map keys to the correct values
- TypeScript types compile and accept the correct field shapes
- Nullable fields accept `null`
- Empty-string fields accept empty strings

These scripts do **not** hit Firestore or external APIs — they're pure import + shape verification. The real-environment aspect is that they import from the compiled shared package, not from source, so they confirm the build output is correct.

### BE area (handlers, CSV parser, refresh manager)

BE verification scripts confirm that each pipeline stage works against the real environment:

- **Ingestion:** call the real AV API (with a real API key) and confirm the response is received
- **Transform:** feed a real (or realistic mock) AV response to the handler's `transformResponse` / `fetch` and confirm the output shape is correct
- **Persistence:** confirm `saveAvData` writes to the correct Firestore path (against prod Firestore)
- **Filtering:** confirm the calendar handler filters to tracked symbols correctly (reads real `tracked_symbols` collection)
- **Factory:** confirm `AlphaVantageHandlerFactory.createHandler()` returns the correct handler instance for each endpoint
- **Refresh manager:** confirm NOT_SUPPORTED endpoints are processed once, not per-symbol

BE scripts that hit prod Firestore or the AV API require the appropriate credentials to be available in the environment.

## File organization

```
functions/scripts/verify/
├── README.md                              ← this file (top-level index)
├── run-all.ts                             ← run-all mechanism
├── earnings-38-sa-endpoint-types.ts       ← Task #38 verification script
├── earnings-38-sa-endpoint-types.md       ← Task #38 per-task guide
├── {domain}-{task-slug}-{stage}.ts        ← future scripts (naming convention)
└── {domain}-{task-slug}.md                ← future per-task guides
```

### Naming convention

Scripts: `{domain}-{task-slug}-{stage}.ts`

- `domain` — the Topic's domain label, lowercased (e.g., `earnings`)
- `task-slug` — the task number + short slug (e.g., `38-sa-endpoint-types`)
- `stage` — the pipeline stage this script covers (e.g., `ingest`, `persist`, `transform`)

Example: `earnings-43-calendar-handler-ingest.ts` — Task #43, calendar handler, ingestion stage.

Guides: `{domain}-{task-slug}.md` — one per task, documenting every verification script written for that task.

## Per-task guides

Each task that has verification scripts gets a `{domain}-{task-slug}.md` guide in this directory. The guide documents:

- Every script written for that task
- The exact command to run each script
- Every flag/argument it accepts
- What a passing result looks like
- What a failing result looks like
- Setup/teardown notes (test data to create/clean up)

## Scripts by task

| Task | Script | Pipeline Stage | Guide |
|---|---|---|---|
| #38 | `earnings-38-sa-endpoint-types.ts` | SHARED: enum + types import verification | [earnings-38-sa-endpoint-types.md](earnings-38-sa-endpoint-types.md) |
| #39 | `earnings-39-config-changes.ts` | SHARED: config values + implemented endpoints verification | [earnings-39-config-changes.md](earnings-39-config-changes.md) |
| #40 | `earnings-40-csv-parser.ts` | BE: CSV parser utility verification | [earnings-40-csv-parser.md](earnings-40-csv-parser.md) |
| #41 | `earnings-41-earnings-handler.ts` | BE: EARNINGS handler transform verification | [earnings-41-earnings-handler.md](earnings-41-earnings-handler.md) |
| #42 | `earnings-42-earnings-estimates-handler.ts` | BE: EARNINGS_ESTIMATES handler transform verification | [earnings-42-earnings-estimates-handler.md](earnings-42-earnings-estimates-handler.md) |
| #43 | `earnings-43-earnings-calendar-handler.ts` | BE: EARNINGS_CALENDAR handler fetch/parse/filter/save verification | [earnings-43-earnings-calendar-handler.md](earnings-43-earnings-calendar-handler.md) |
| #44 | `earnings-44-factory-registration.ts` | BE: Factory registration + isGlobalEndpoint helper verification | [earnings-44-factory-registration.md](earnings-44-factory-registration.md) |
| #97 | `symbol-manager-97-companyinfo-writeback.ts` | BE: companyInfo marketCap/beta write-back (transform + persistence) | [symbol-manager-97-companyinfo-writeback.md](symbol-manager-97-companyinfo-writeback.md) |
| #98 | `symbol-manager-98-sortable-fields.ts` | BE: sortBy whitelist + composite index + ordering verification | [symbol-manager-98-sortable-fields.md](symbol-manager-98-sortable-fields.md) |
| #99 | `backfill/backfill-companyinfo-numbers.ts` (mutating, not in run-all) | BE: one-time marketCap/beta backfill — dry-run/re-run idempotency | [symbol-manager-99-backfill.md](symbol-manager-99-backfill.md) |
| #122 | `options-data-122-zigzag-engine.ts` | SHARED: compiled zigzag engine on real daily bars (transform) | [options-data-122-zigzag-engine.md](options-data-122-zigzag-engine.md) |
| #123 | `options-data-123-swing-set-types.ts` | SHARED: paramsId + corpus config + SwingSetDoc assembly (transform) | [options-data-123-swing-set-types.md](options-data-123-swing-set-types.md) |
| #124 | `options-data-124-swing-set-data-layer.ts` *(mutating, not in run-all)* | BE: DailyAdjustedReader + SwingSetRepository (ingestion + persistence; writes + deletes temp ZZTEST doc) | [options-data-124-swing-set-data-layer.md](options-data-124-swing-set-data-layer.md) |
| #125 | `options-data-125-swing-set-generation.ts` *(mutating, not in run-all)* | BE: SwingSetGenerationService end-to-end (writes + deletes the corpus doc) | [options-data-125-swing-set-generation.md](options-data-125-swing-set-generation.md) |
| #126 | `options-data-126-swing-set-task.ts` *(mutating, not in run-all)* | BE: generateSwingSetsTask internals — optionsEnabled enqueue gate, freshness skip, invalid-payload ack | [options-data-126-swing-set-task.md](options-data-126-swing-set-task.md) |
| #127 | `options-data-127-swing-set-sweep.ts` *(mutating, not in run-all)* | BE: runSwingSetSweep — optionsEnabled enumeration, freshness skip, force/subset gating, per-symbol isolation | [options-data-127-swing-set-sweep.md](options-data-127-swing-set-sweep.md) |
| #138 | `options-data-138-optionable-probe.ts` *(mutating, not in run-all)* | BE: OptionableProbeService — probe + persist round-trip on an already-probed symbol | [options-data-138-optionable-probe.md](options-data-138-optionable-probe.md) |
| #139 | `options-data-139-on-add-probe.ts` *(mutating, not in run-all)* | BE: ingestion defaults + on-add probe transition core gates (no-transition/already-probed/probed) | [options-data-139-on-add-probe.md](options-data-139-on-add-probe.md) |
| #148 | `options-data-148-swing-set-smoke.ts` *(read-only, not in run-all)* | Post-deploy smoke: deployed backfillSwingSets + functions:list presence via x-admin-secret | [options-data-148-swing-set-smoke.md](options-data-148-swing-set-smoke.md) |
| #140 | `options-data-140-set-options-enabled.ts` *(mutating, not in run-all)* | BE: curation core — not-found gate, enable→enqueue, idempotent re-enable, disable | [options-data-140-set-options-enabled.md](options-data-140-set-options-enabled.md) |
| #142 | `options-data-142-list-flag-filtering.ts` *(read-only, not in run-all)* | Post-deploy: partnerListTrackedSymbolsV2 ?optionable=/?optionsEnabled= filtering via real OIDC | [options-data-142-list-flag-filtering.md](options-data-142-list-flag-filtering.md) |
| #119 | `ops-119-firestore-indexes.ts` | OPS: firestore.indexes.json ↔ prod drift check | [ops-119-firestore-indexes.md](ops-119-firestore-indexes.md) |

## Execution order

Run scripts in task dependency order. The dependency chain for the earnings Topic (#33):

1. **#38** (SHARED: enum + types) — no dependencies
2. **#39** (SHARED: config changes) — blocked by #38
3. **#40** (BE: CSV parser) — blocked by #39
4. **#41** (BE: EARNINGS handler) — blocked by #39
5. **#42** (BE: EARNINGS_ESTIMATES handler) — blocked by #39
6. **#43** (BE: EARNINGS_CALENDAR handler) — blocked by #40, #39
7. **#44** (BE: factory + refresh manager) — blocked by #41, #42, #43

Topic #88 (Symbol Manager company overview):

1. **#97** (BE: companyInfo write-back) — no dependencies
2. **#98** (BE: sortBy whitelist + indexes) — blocked by #97 (needs the numeric fields); also requires the composite indexes to be deployed and built
3. **#99** (BE: backfill) — mutating one-time script; run once, then re-verify via #98's script. Not in run-all.

Topic #102 (Swing-driven options corpus):

1. **#122** (SHARED: zigzag engine port) — no dependencies
2. **#123** (SHARED: swing-set types + paramsId + canonical configs) — blocked by #122 (consumes the engine)
3. **#124** (BE: data layer) — blocked by #122, #123; **mutating** — writes a temporary `ZZTEST_*` probe doc and deletes it (not in run-all)
4. **#125** (BE: generation service) — blocked by #124; **mutating** — writes + deletes `{SYMBOL}_{paramsId}` docs (not in run-all)
5. **#126** (BE: task handler) — blocked by #125; **mutating** — writes + deletes `tracked-symbols/ZZTEST` + `ZZTEST_*` docs (not in run-all)
6. **#127** (BE: sweep/backfill) — blocked by #126; **mutating** — same ZZTEST pattern; baseline sweep regenerates real stale enabled symbols (not in run-all)
7. **#128** (BE: partner read endpoint) — blocked by #125; **mutating** — same ZZTEST pattern (not in run-all)

Topic #118 (Repo & deploy hygiene):

1. **#119** (OPS: index drift check) — no dependencies; run after any index deploy or suspected drift

Run all scripts for a task after the task's implementation is complete and unit tests pass. The run-all script handles ordering automatically.

## Important notes

- **Never wire these into CI or `npm test`.** They hit prod directly. Running them automatically on every commit would mean real side effects on prod on every PR.
- **Run them deliberately.** After implementing a task, run its verification scripts manually to confirm the pipeline works end-to-end.
- **Scripts are committed artifacts.** They live in the repo, are version-controlled, and are committed alongside the implementation code they verify.
- **If a script surfaces an uncovered pipeline stage, write another script for it.** Keep going until every part of the pipeline the task touches is confirmed working, not just the happy path you started with.

**Topic:** Options Corpus Bulk Ingest  
**Topic Slug:** options-data  
**Thread:** Full-Date Corpus Backfill (2026)  
**Thread Slug:** corpus-backfill-2026  
**Issue:** #236  
**Thread Parent:** #214  
**Topic Parent:** #213  
**Task:** #222  
**Domain:** BE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-28  
**Last Updated:** 2026-10-28  

# UAT — Task #222: Cell doc writer (`mergeDayEntries`)

## Scope

Confirms the Firestore merge writer for
`options-delta-picks/{cellId}/years/{YYYY}` behaves per the SPEC contract:
the merge decision table (absent→write, repairable miss→upgrade, pick→
immutable), header-field consistency, per-year-doc batched transactions,
year-boundary sharding by chain date, idempotent re-runs, and input
validation.

## Prerequisites

- Repo at `C:\aa\projects\av-proxy-api`; run all commands from `functions/`.
- Node + deps installed (`npm ci` if needed).
- For S4 only: ADC auth (`gcloud auth application-default login`) with
  Firestore read/write on prod. The script is self-cleaning: it writes then
  deletes `options-delta-picks/ZZTEST-put-20-45/years/{2099,2100}` probe docs.

## Scenarios

### S1 — Focused unit tests (merge decision table + headers + validation)

```bash
cd functions
npx jest tests/v2/historical-options-corpus/options-delta-pick-cell.writer.test.ts
```

Expected: all tests pass — decision table (absent/miss/pick/unrecognized),
header recompute, year-boundary sharding, idempotent zero-write, validation
throws (cellId, day key, neither/hybrid/primitive shapes).

### S2 — Full suite regression

```bash
cd functions
npx jest
```

Expected: all suites pass — writer shares Firestore/Shared seams with the
corpus services; nothing else may regress.

### S3 — Typecheck

```bash
cd functions
npx tsc --noEmit
```

Expected: clean — the `updatedAt: FieldValue` write-shape and readonly-map
input types compile against real SDK types.

### S4 — Prod persistence verify (mutating, self-cleaning)

```bash
cd functions
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-222-cell-writer.ts
```

Expected: every `PASS:` line, ending `ALL CHECKS PASSED — mergeDayEntries
verified on prod`. Confirms against REAL Firestore: doc scaffold fields,
equal-rank skip, `no_chain`→pick self-repair, pick immutability
(pick→pick + pick→miss), 2099/2100 year-boundary sharding, idempotent
zero-write re-run, and cleanup. This is the persistence-level gate — unit
tests use an in-memory tx fake; S4 is what proves real Firestore behavior
(transaction commits, serverTimestamp, subcollection paths).

### S5 — Caller-surface probe

```bash
cd functions
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json -e "
const { mergeDayEntries } = require('./src/v2/historical-options-corpus/services/options-delta-pick-cell.writer');
console.log(typeof mergeDayEntries);
"
```

Expected: prints `function` — the export resolves through the services
barrel for downstream tasks (#223 fanout, #224 nightly). (Alternative:
`import { mergeDayEntries } from './services'` resolves in src — barrel
export already exercised by `tsc --noEmit` in S3.)

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| AC1 — Merge semantics: absent→write, miss→upgrade-allowed, pick→immutable | S1 (8 decision-table tests) + S4 steps 1–4 |
| AC2 — Header fields consistent after merges | S1 (scaffold/recompute tests) + S4 steps 1,3 |
| AC3 — Batched writes (multi-date + single-date) | S1 (single-tx multi-date test) + S4 steps 3,5 |
| AC4 — Unit tests covering merge decision table | S1 (22 tests; in-memory tx fake per repo convention — emulator deviation documented in review) |
| TEST edge — year boundary shards by chain date | S1 + S4 step 5 |
| TEST edge — idempotent re-run → zero writes | S1 + S4 step 6 |
| Robustness — malformed inputs rejected | S1 (cellId/day-key/neither/hybrid/primitive) |
| SPEC — miss→more-informative upgrade (pick>no_match>no_chain) | S1 + S4 steps 2–4 |

## Refinement pass

Not applicable — no user-facing surface (backend writer consumed by #223/#224).

## Execution log

| Scenario | Result | Evidence |
|---|---|---|
| S1 focused tests | PASS | 22/22 pass |
| S2 full suite | PASS | 91 suites / 945 tests |
| S3 typecheck | PASS | `tsc --noEmit` clean |
| S4 prod verify | PASS | all 23 checks PASS on prod (2026-10-28, post-review-fix re-run) |
| S5 caller surface | PASS | `mergeDayEntries` exported via `services/index.ts` barrel; resolves under `tsc` |

## Findings

None unresolved. Three minors fixed in-review before QA (tx-retry
duplication, dead-entry footgun, primitive/`in` TypeError at both guard
points). Deviations documented in the code review: impl signature adds
`db` + derives year per-date; AC's "emulator" wording met by in-memory tx
fake + real-prod verify.

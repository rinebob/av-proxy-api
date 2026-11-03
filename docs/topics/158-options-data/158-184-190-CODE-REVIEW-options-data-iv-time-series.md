# Code Review — Task #190 (IV rank prod verify script)

**Topic:** #158 (options data / IV time series) · **Thread:** #163 (IV rank) ·
**Blueprint:** #184 · **Task:** #190 · **Reviewed:** uncommitted working-tree
state after two fix rounds · **Reviewer:** Devin `/proj review 158 190`

**Files under review**

| File | State |
|---|---|
| `functions/scripts/verify/options-data-190-iv-rank.ts` | new |
| `functions/scripts/verify/options-data-190-iv-rank.md` | new |
| `functions/scripts/verify/README.md` | modified (registration row) |
| `functions/scripts/verify/run-all.ts` | modified (documented exclusion comment) |

Adjacent-but-unrelated working-tree changes (`docs/partner/partner-endpoint-inventory.md`
`partnerIvRankV2` row; Topic #213 golden-picks files) were noted and left
out of scope.

---

## Verdict: **PASS** (after two review rounds, all findings resolved)

### Round 1 — axis results

| Axis | Verdict | Headline |
|---|---|---|
| Standards | no critical issues | Polish items: aud doc, `optionsEnabled` warning, `assert(true)` misuse, `WINDOWS` duplication |
| Spec | met, two gaps | Missing `## Passing result` / `## Failing result` sections; "rank fields on rows" ambiguity — could read as `partnerIvMetricsV2` rows |
| Thermo-nuclear | **REQUEST CHANGES** | M1 vacuous `minN` checks · M2 `asOfDate` mask (`String(undefined) >= date` passes) · M3 no `optionsEnabled` guard → screener pollution · M4 all-rank-fields-absent could still pass |

### Round 1 → fixes applied

| Finding | Resolution |
|---|---|
| M3 — `computeRankForDate` has no enabled gate; arbitrary symbol injects `iv-rank-latest/{SYM}` into the screener | Preflight: script reads `tracked-symbols/{SYM}` and refuses unless `optionsEnabled === true`; guide warns explicitly |
| M1 — `minN` checks vacuous (`.every` on possibly-empty rows; healthy data satisfies `n>=2` regardless of wiring) | `minN=999999` → `count===0` (proves numeric wiring); `minN=2` asserts non-empty; **discriminating check**: find a row with `ivN30 < ivN360`, then `sort=ivRank30&minN={ivN360}` must drop it while the no-sort fallback keeps it — proves the floor reads the sort window's `ivN`, not `ivN360`. `SKIP` line if no such row exists |
| M2 — `String(doc.asOfDate) >= date` masks missing/malformed values; `!latestUpdated` used `>=` | `asOfDate` must be a `/^\d{4}-\d{2}-\d{2}$/` string; `latestUpdated=false` requires strictly `>` |
| M4 — table check could pass with `ivRank360` absent everywhere | Own-row parity: wire `ivN360`/`ivRank360` must equal the Firestore doc read-back |
| Spec — `metrics=` row verification ambiguity | New step 8: `partnerIvMetricsV2?metrics=ivRank360,ivN360` → row keys ⊆ requested fields. Revealed a real doc bug (below) |
| Spec — Pass/Fail sections | Added `## Passing result` / `## Failing result` with exit codes, acceptable `SKIP`, and the live-seed-race / stale-field failure modes |
| Standards — aud doc | Guide mints with base-host aud (see below); explains function-scoped auds drift across secret-pin versions |
| Standards — 401 vs 403 | Corrected: missing `--include-email` → 403 (no `email` claim), not 401 |
| Nits | `assert(true,…)` → `console.log PASS`; all-four-`ivN` assert replaces tautological `.some`; shared `IV_RANK_WINDOWS` replaces local `WINDOWS`; `ignoreUndefinedProperties` set on the client to match prod writer fidelity; `count===rows.length`; `code==='BAD_REQUEST'` on 400s; `minN=-1`/`2.5` → 400; `POST` → 405 (raw fetch wrapped in try/catch after a live transport flake); `dir=asc` sink re-checked (only direction proving sink vs sort-as-0); TOCTOU comment on the latest-doc asserts |

### Live-run findings during verification

1. **Function-scoped auds are not portable.** A token minted with
   `--audiences=…/partnerIvRankV2` returns **403** from
   `partnerIvMetricsV2` — each function pins its own
   `EXPECTED_GOOGLE_AUDIENCE` version and the metrics function's pinned
   version predates the rank URLs. The base-host aud
   (`…/alpha-vantage-proxy-api.cloudfunctions.net`) is in every version →
   **200 on both**. Guide mints with base host.
2. **Discriminating check found a real data point**: NTAP has
   `ivN30=14 < ivN360=148` — `sort=ivRank30&minN=148` drops it, the
   `ivN360` fallback keeps it. Window mapping proven live, not just in unit tests.
3. Two transient `oauth2.googleapis.com` ADC flakes during runs —
   environment connectivity, not script defects; one raw `fetch` was
   wrapped to fail cleanly instead of crashing.

### Round 2 — re-review of the post-fix file

Full read of the fixed script found three more real findings plus nits:

| Finding | Resolution |
|---|---|
| `callEndpoint` didn't catch transport errors — a blip on any of ~10 call sites crashed the script (`FAIL (uncaught): fetch failed`, observed live) | `fetch` wrapped → `{ok:false, status:0}` → clean FAIL lines downstream |
| Discriminator asserts vacuous on non-200 — `!(rows ?? []).some(...)` passes when `rows` is undefined | Both `mappedFloor`/`fallbackFloor` asserts now require `status === 200` |
| `date` arg unvalidated — a malformed arg could write `days.<garbage>` into a real year doc | `^\d{4}-\d{2}-\d{2}$` assert before any Firestore writes |
| `.ts` env block omitted `IV_METRICS_ENDPOINT`; `.md` referenced "step 8" for the metrics check (item 9 in its own list) | Both corrected |

The transport fix proved itself in the same session: a run hit a real
`fetch failed` on the sorted-table call and produced a clean
`FAIL: sorted table 200 (got 0)` + exit 1 instead of a stack-free crash —
exactly the intended behavior for a verification harness.

### Final verification state

- `npx ts-node … options-data-190-iv-rank.ts QQQ 2026-10-30` → **41/41 PASS** (round 2 added the date-arg assert)
- `cd functions && npx tsc --noEmit` → clean
- `cd functions && npx jest` → 106 suites / 1,222 tests pass
- Mutating semantics unchanged: writes only the feature's own outputs
  (`days.{date}` metric+rank fields, latest-guarded `iv-rank-latest`);
  excluded from `run-all.ts` with a comment; README row registered.

---

## Residual notes (non-blocking)

- **`ivPct*`/`ivN*` sort fields** untested live (12 sort whitelist
  members exist; spot-checking one rank + one fallback window covers the
  shared comparator path — remaining fields are the same code path).
- **TOCTOU**: a concurrent nightly seed pass can legitimately race the
  read-back asserts; documented in guide's Failing-result section.
- **Stale withheld-field edge** (known upstream limitation): a shrunk
  window can leave a lingering `ivRank{W}` on an old day entry; the
  presence-invariant check would correctly FAIL — documented rather than
  suppressed.

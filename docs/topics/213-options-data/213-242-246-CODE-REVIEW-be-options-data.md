**Topic:** Options Corpus Bulk Ingest  
**Topic Slug:** options-corpus-bulk-ingest  
**Thread:** Contract Availability Endpoint  
**Thread Slug:** availability-endpoint  
**Issue:** #246  
**Thread Parent:** #237  
**Topic Parent:** #213  
**Task:** #246  
**Domain:** BE  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-10-31  
**Last Updated:** 2026-10-31  

# Code Review — Task #246: availability endpoint verify script

## Scope

| File | Change |
|---|---|
| `functions/scripts/verify/options-data-246-contract-availability.ts` | NEW — read-only deployed-endpoint verify (~265 lines, 12 checks) |
| `functions/scripts/verify/options-data-246-contract-availability.md` | NEW — companion guide |
| `functions/scripts/verify/README.md` | MOD — registry row + execution-order entry |
| `functions/scripts/verify/run-all.ts` | MOD — registered in read-only SCRIPTS list |

## Axis results

| Axis | Verdict |
|---|---|
| Standards | PASS WITH MINORS |
| Spec | PASS |
| Thermo-nuclear | PASS WITH MINORS |

## Findings and dispositions

### Fixed during review

| Sev | Finding | Disposition |
|---|---|---|
| Minor | `require('google-auth-library')` was unconditional at module top — it's only a *transitive* dep (via firebase-admin); if a dep bump ever dropped it, the script would die at module load, breaking even the unauthed 405/401 checks and `run-all` | **Fixed** — lazy `require` inside the `GOOGLE_APPLICATION_CREDENTIALS` branch |
| Minor | `--include-email` passed to `gcloud auth print-identity-token` for a *user* identity — impersonation-only flag → gcloud errors → the 403 check would have silently skipped in every real run (dead check) | **Fixed** — flag removed; user tokens carry `email` automatically |
| Minor | Cloud-Run-level 403 (no `run.invoker`) vs app-level `403 FORBIDDEN` not distinguished — would surface as a confusing `got 403/undefined` on both token paths | **Fixed** — user-token path reports `SKIP` with a clear note; SA path fails with an explicit "no run.invoker — not the app envelope" message |

### Accepted / noted

| Sev | Finding | Disposition |
|---|---|---|
| Info | `{ status: res.status, ...body }` spread order — a future `status` field in the JSON body would silently overwrite the HTTP code | **Accepted** — shared convention with `options-data-173-iv-metrics-endpoint.ts`; the response contract carries no `status` field |
| Info | All-put + single-expiration catalog can't be narrowed by any filter | **Accepted** — `type=put` narrowing falls back to an explicit `expirations` list; the double-edge case is unrepresentable and would fail loud |
| Info | `COST` default symbol — a known options-enabled symbol with a small catalog (well inside the 60s budget); overridable via `argv[2]` | **Accepted** — documented in the .md |

## Spec traceability

| AC | Evidence |
|---|---|
| Script hits deployed endpoint for a known options-enabled symbol | `argv[2]` default `COST`; 404-not-deployed reported distinctly |
| Envelope shape, contracts non-empty + entry fields, `corpusDates` sorted `YYYY-MM-DD`, ≥1 filter narrows, `truncated` present | Checks 3–6 |
| Read-only — no Firestore/GCS writes, eligible for run-all | All calls are GET + one POST rejected at the method gate before any work; registered in `SCRIPTS` |
| Companion `.md` + README row + execution-order entry | All present |

**Beyond the ACs** (per #245 review's handoff): 403 non-SA path (check 10), `expirations` 30-cap boundary (check 9), and type-pinned `firstObserved`/`strike`-primary queries that exercise the two new composite indexes through the real endpoint (checks 7–8 — a missing index surfaces as `FAILED_PRECONDITION` → 500).

## Verification evidence

- `tsc --noEmit -P scripts/tsconfig.json` — clean
- Full suite: **99 suites / 1,085 tests** green
- Live run: correctly fails fast — `FAIL: endpoint returned 404 — partnerContractAvailabilityV1 is not deployed yet` (the deployed-run evidence belongs to QA post-deploy)

## Verdict: **PASS**

All acceptance criteria met; all findings fixed or dispositioned. The live end-to-end pass is deferred to QA by design — the script's first act is a loud not-deployed check.

## Re-review — 2026-10-31 (second pass)

Re-read of the full script after the first-pass fixes, hunting for check-logic bugs the first review missed.

| Sev | Finding | Disposition |
|---|---|---|
| Minor | Check 7 pinned `type=put` + `firstObserved` to the first **corpus** date — but `firstObserved` (catalog field) and corpus dates are independent dimensions; a healthy endpoint could legitimately return 0 puts and fail | **Fixed** — pin type + `firstObserved` to `contracts[0]` (guaranteed hit, still a bounded 1-day range through the composite index) |
| Minor | Check 6 hardcoded `type=put` — on a call-only catalog `putContracts` is `[]`, `every()` passes vacuously, and `0 < N` "narrows" without proving filtering | **Fixed** — filter on `contracts[0].type` so the subset is guaranteed non-empty and provably type-filtered |
| Minor | Unauthed check 1 didn't distinguish Cloud-Run 403 (function lacks `allUsers` invoker → edge blocks before app auth) from the expected app-level 401 | **Fixed** — explicit FAIL message naming the missing grant |
| Nit | `contracts[0].type` re-declared as `t0` in check 8 after check 6 introduced it | **Fixed** — check 8 reuses the outer `t0` |

`tsc -p scripts/tsconfig.json` clean after fixes. **Conclusion:** no further passes needed — all checks are now data-derived (guaranteed hits) or boundary-pinned; residual env-dependent paths (SA creds, user-token invoker, deploy state) already report distinct SKIP/FAIL messages.

## Re-review — 2026-10-31 (second pass)

Full re-read of the script post-PASS. Findings:

| Sev | Finding | Disposition |
|---|---|---|
| Minor | `fetch` had no timeout — a hung endpoint/stalled connection would hang the script and through it `run-all` indefinitely | **Fixed** — `AbortSignal.timeout(70_000)` (bounds past the function's 60s timeout) |
| Nit | `badEntry` assert failed without identifying the offending entry | **Fixed** — assert message now embeds the first bad entry (truncated to 200 chars) |

No other findings: sequential-call ordering is intentional (readable PASS log), skip/fail semantics verified on every path (unauthed, Cloud-Run IAM, app-level, cap boundary), and all ACs remain traced. `tsc` clean; live run still fails fast on 404 by design.

**Conclusion:** no further pass needed — remaining surface is covered or dispositioned.

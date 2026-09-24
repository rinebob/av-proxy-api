# Code Review — Task #119: Reconcile firestore.indexes.json with prod

**Topic:** Repo & Deploy Hygiene  
**Topic Slug:** repo-deploy-hygiene  
**Issue:** #118  
**Topic Parent:** #118  
**Task:** #119  
**Domain:** OPS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-09-24  
**Last Updated:** 2026-09-24  

*(No Blueprint exists for this Topic — the bug task is a direct child of the anchor; `Issue` points to #118.)*

## Scope

| File | Change |
|---|---|
| `firestore.indexes.json` | Rewritten — verbatim `firebase firestore:indexes` export (78 indexes, no explicit `__name__`) |
| `firestore.indexes.README.md` | Rewritten — source-of-truth policy, format rule, drift procedure |
| `docs/operations/firestore-indexes-deploy.md` | New — incident write-up + how-to guide |
| `functions/scripts/verify/ops-119-firestore-indexes.ts` | New — bidirectional drift detector |
| `functions/scripts/verify/ops-119-firestore-indexes.md` | New — script guide |
| `functions/scripts/verify/run-all.ts`, `README.md` | Script registered |

## Standards

No hard violations. Script follows verify-script conventions (header comment, `assert()` helper, PASS/FAIL, exit codes — matches `symbol-manager-98-sortable-fields.ts`). Guide covers purpose/command/pass-fail/teardown per README convention. Read-only script correctly registered in run-all.

Findings (all addressed):

- **minor** — Unguarded `JSON.parse(res.stdout)` + `res.error` never inspected → added `parseJson` guard + ENOENT check.
- **nit** — `fieldOverrides` compared via raw `JSON.stringify` (key-order fragile) → canonical stringify added.
- **nit** — Assert messages inverted semantics → reworded.
- **judgement** — `assert()` duplicated from sibling script → convention-established, declined.

## Spec (issue #119)

All four proposed-direction items implemented: file regenerated from prod export, redeploy confirmed clean no-op, README rewritten, drift policy documented (README + ops doc). Verified file contents match claims (78 indexes, no `__name__`, `fieldOverrides` retained).

Findings (all addressed):

- **minor** — `__name__` format rule documented but not enforced → explicit rejection check added to the script.
- **nit** — ops doc said "~50 indexes"; issue verified 47 → corrected.

## Thermo-nuclear

No structural regressions, no missed simplifications. Clean single-purpose script.

Findings (all addressed):

- **minor** — Same inverted assert messages → fixed.
- **minor** — Unguarded parse / `res.error` → fixed.
- **minor** — `shell: true` diverges from `partner-auth-test.ts`'s spawn machinery but is defensible for a 96-line script → comment added noting it's required for `firebase.cmd` on Windows.
- **nit** — `indexKey` order/arrayConfig concatenation lacked a separator → added.
- **nit** — `fieldOverrides` raw stringify → canonical compare (shared with Standards finding).

## Test results

`npm test`: **59/59 suites, 555/555 tests green.**

⚠ **Pre-existing unrelated failure fixed in-flight:** `contract-summary-aggregator.service.test.ts` (committed a2a2b6d, July) used `require('../../../src/...')` — one `../` short for its depth (`tests/v2/historical-options-corpus/services/` needs `../../../../src`, matching same-depth siblings like `swing-set-generation.service.test.ts`). 6 tests failed on every full-suite run before this change. Fixed the path (6 occurrences) to unblock the gate; unrelated to #119's diff.

## Verdict

**PASS** — no critical or major findings; all minors/nits remediated; suite green; deploy verified as clean no-op against prod.

**Topic:** Swing-driven options corpus platform  
**Topic Slug:** swing-driven-options-corpus  
**Thread:** Swing-set generation platform  
**Thread Slug:** swing-set-platform  
**Issue:** #121  
**Thread Parent:** #103  
**Topic Parent:** #102  
**Task:** #126  
**Domain:** OPTIONS-DATA  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-23  
**Last Updated:** 2026-09-23  

---

# Code Review — Task #126: generateSwingSetsTask + optionsEnabled trigger

Three axes reviewed: `handlers/generate-swing-sets.{core,task}.ts`, `save-tracked-symbol.function.ts`, barrel + `src/index.ts` edits, the task test, and `options-data-126-swing-set-task.{ts,md}`.

## Standards

- **Fixed:** the Firestore test fake was on its third copy — extracted `tests/v2/swing-set/fake-firestore.ts` (`createFakeFirestore(seed)` with calls recording) shared by all three swing-set test files.
- **Fixed:** split the task file — `generate-swing-sets.core.ts` (side-effect-free: validation, freshness, enqueue helper) + thin `generate-swing-sets.task.ts` wrapper, matching the corpus-seed worker/task pattern. Tests no longer pull `firebase-admin-init` at require time, and the core can live in the barrel.
- Judgement calls accepted: double `optionsEnabled` gate (caller payload check + persisted-doc re-read), optional `enqueue`/`nowMs` test deps, 20h TTL freshness (documented; #127 owns the data-timestamp refinement).

## Spec

- All four ACs met: `{symbol}` payload processing, trigger wiring via the `saveTrackedSymbol` direct call site (Thread #105 hooks will reuse `enqueueSwingSetGeneration`), idempotent re-runs (merge-upsert + freshness gate), enqueue only for `optionsEnabled` symbols.
- Queue name `generateSwingSetsTask` matches the exported function id (repo convention).
- Noted, not blocking: the trigger is level-triggered (every save with `optionsEnabled=true` enqueues — bounded by the helper's flag check + task freshness gate); no runtime flag re-check in the handler (out of AC scope).

## Thermo-nuclear

- **Fixed (minor):** `swingSetsAreFresh` treated future-dated `generatedAt` as fresh (a clock-skewed doc could suppress regeneration past TTL) — skew beyond 5min now counts as stale; covered by a new test.
- **Fixed (minor):** `enqueueSwingSetGeneration` lacked an empty-symbol guard before `db.doc('')`.
- **Fixed (real infra finding):** writing `tracked-symbols/ZZTEST` fires the `onSymbolAdded` trigger, which *recreates* the doc after the verify script deletes it — cleanup now waits 8s and deletes again; pre-flight aborts if `ZZTEST` exists.
- Verified: read-after-write consistency of the persisted-flag re-read, `Pick<…,'generateForSymbol'>` seam, enqueue ordering after `docRef.set` commit, retry config (service throws → `maxAttempts: 3`; invalid payload → ack).
- Accepted: 20h TTL stale window documented — a symbol enabled pre-close gets docs from yesterday's bars until the next trigger; #127's sweep closes the gap.

## Test results

- `tests/v2/swing-set/`: **39/39 pass** (14 task tests: enqueue gate ×4, empty symbol, invalid payloads, fresh/stale/skewed/partial gates, error propagation).
- Verify script: **PASS** against prod (gate, payload shape, freshness, graceful no-data, trigger-artifact cleanup).
- Pre-existing unrelated failure unchanged (`contract-summary-aggregator.service.test.ts` — Thread #108).

## Re-review (second pass)

All pass-1 fixes verified on all three axes:

- Core module confirmed side-effect-free (`firebase-admin/functions` import is inert; `getFunctions()` lazy-called only in the default enqueue); tests + verify script require `.core`; barrel exports core without admin-init leak.
- Skew clamp, empty-symbol guard, shared fake (superset — `opts` recording preserves the repo's `{merge:true}` assertion) all verified.
- **Fixed (major, pass 2):** the 8s settle was insufficient — `onSymbolAdded` awaits three AV fetches before recreating the doc, so its write can land >60s out and *after* the script exits. Cleanup now polls up to ~2min, re-deleting the recreated doc until it stays absent across consecutive checks.
- **Fixed:** shared fake `set()` now honors `opts.merge` (absent → replace), matching real Firestore semantics.
- Noted, unchanged: level-triggered enqueue (bounded by helper flag-check + freshness gate), 20h TTL stale window (#127 sweep owns the data-timestamp refinement).

## Verdict

**PASS** — two passes: module split removes the admin-init test seam, freshness hardened against clock skew, enqueue guarded, shared fake extracted, prod-cleanup trigger artifact handled with poll-delete.

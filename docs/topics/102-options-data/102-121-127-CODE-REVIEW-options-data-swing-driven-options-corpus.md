**Topic:** Swing-driven options corpus platform  
**Topic Slug:** swing-driven-options-corpus  
**Thread:** Swing-set generation platform  
**Thread Slug:** swing-set-platform  
**Issue:** #121  
**Thread Parent:** #103  
**Topic Parent:** #102  
**Task:** #127  
**Domain:** OPTIONS-DATA  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-24  
**Last Updated:** 2026-09-24  

---

# Code Review — Task #127: sweepSwingSets + backfillSwingSets

Three axes reviewed: `handlers/swing-set-sweep.core.ts`, `sweep-swing-sets.scheduler.ts`, `backfill-swing-sets.http.ts`, `common/http-admin.ts` (new), `function-schedules.ts`, barrel + `src/index.ts`, the sweep test, shared fake edits, and `options-data-127-swing-set-sweep.{ts,md}`.

## Standards

- Core/wrapper split matches the #126 pattern; schedule const follows `function-schedules.ts` convention; `x-admin-secret` + `withCors` + `{ok,...}` envelope match the pilot-trigger convention.
- **Fixed:** third copy of `isAdmin`/`normalizeSymbols` extracted to `v2/common/http-admin.ts` (`requireAdminSecret`, `normalizeSymbolList`); pilot handlers keep their copies — migrate on next touch.
- **Fixed:** convoluted inline dryRun stub — `dryRun` is now a first-class `SweepDeps` flag producing a `wouldGenerate` bucket.

## Spec

- All ACs met: enabled-only enumeration, freshness skip (shared `swingSetsAreFresh`), idempotent/repeatable backfill, `onSchedule` = firebase-config scheduling (Terraform not used — AC is an OR), per-symbol failure isolation.
- Freshness remains TTL-based; IMPL open question (data-timestamp) documented as deferred — sweep owns it going forward.
- Inline `generateForSymbol` vs enqueueing tasks: correct at current scale (~1–3s/symbol, headroom to ~200–400 enabled within 540s); the #126 queue is the escape hatch.

## Thermo-nuclear

- **Fixed (minor):** `symbols: []` previously fell through to a full sweep — now `symbols !== undefined` means an explicit empty subset sweeps nothing.
- **Fixed (minor):** dryRun mislabeled results — `wouldGenerate` bucket + core-level flag; HTTP handler is now a single core call.
- **Fixed (minor):** verify cleanup now also deletes `symbol-data/ZZTEST` (written by the `onSymbolAdded` trigger); poll-delete retained for the recreate race.
- Verified: single-field `==` needs no index; docId==symbol convention holds; fail-closed secret check; `maxInstances:1`; read-after-write safety.
- Noted, accepted: mid-sweep disable race (idempotent writes); `where()` fake only implements `==` (documented); verify baseline regenerates real enabled symbols — documented in the guide.

## Test results

- `tests/v2/swing-set/`: **49/49 pass** (10 sweep tests incl. dryRun + empty-subset edge).
- Verify script: **PASS** against prod (enumeration gate, fresh-skip, stale regen, force, subset, disable, no residue).
- Build clean.

## Verdict

**PASS** — all ACs; review found only minors, all addressed. Deploy requires `firebase deploy --only functions` + `SWING_SET_ADMIN_SECRET` in Secret Manager.

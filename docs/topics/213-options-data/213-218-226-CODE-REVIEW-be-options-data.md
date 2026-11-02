**Topic:** Options Corpus Bulk Ingest  
**Topic Slug:** options-data  
**Thread:** Full-Date Corpus Backfill (2026)  
**Thread Slug:** corpus-backfill-2026  
**Issue:** #218  
**Thread Parent:** #214  
**Topic Parent:** #213  
**Task:** #226  
**Domain:** BE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-01  
**Last Updated:** 2026-11-01  

## Re-review — Pass 2 (post-remediation)

All three axes re-ran against the remediated state. **No new critical or
major findings** — pass-1 majors verified closed (bless-path guards,
oracle drift-guard test, provenance drift check). Pass-2 surfaced only
minors/nits, all fixed in this pass:

- minor — `--write-asset` oracle/defect loops lacked a missing-day guard:
  an absent `regenDays[date]` would `TypeError` inside `isPickEntry`
  instead of a clean FAIL → explicit `entry !== undefined` assert added;
  defect-refusal filter guards the same case.
- nit — miss-branch PASS line could log "oracle would pick undefined" →
  message only names the contract when one exists.
- nit — guide documented only 1 of 3 bless guards → all three now listed.
- nit — SPEC doc didn't mention the asset-only `provenance` key →
  parenthetical added in the example block.
- nit — `target` formula duplicated in `selectWinner` and `reconcileDay` →
  extracted to `signedTargetDelta`.
- nit — convoluted group-by idiom + double `!` assertion in `selectWinner`
  → cleaned; misnamed test fixture var renamed.
- judgement — `no_chain → no_match` repaired-gap doesn't prove
  `winner === null`: unreachable via production (`no_match` requires a
  loaded chain) and covered by the bless-mode oracle loop → accepted.
- judgement — core is ~390 lines (300 target, 400 smell threshold): the
  oracle duplication is the point; drift-guard test pins it to production.
- info — drift-guard asserts contract/expiration, not every pick field;
  field-level drift is covered by `reconcileDay`'s unexplained path at
  verify time → accepted.

**Final verdict: PASS** — 106 suites / 1,222 tests green, `tsc` clean,
prod verify: `identical=21`, `INPUTS: 0/21 drifted`, `LIVE-DOC: 0 diffs`.

## Pass 1 — initial review (findings → remediation)



All three axes ran against the final state. **Verdict: PASS** — all
critical/major findings remediated and re-verified; remaining items are
documented judgement calls and nits.

### Context — what #226 verified

The golden-file gate: `options-data-226-golden-picks.ts` replays the
production `materializeSymbolPicks` → `pickCellsForDate` → `mergeDayEntries`
path for the 21 golden dates with real GCS corpus + real adjusted-close
reads and an in-memory Firestore store, then asserts **strict day-for-day
equality** vs `.example.json`.

**Key investigation result (AC#3):** the original `.example.json` was
proven **not** to be pipeline output — literal `"<serverTimestamp>"`
`updatedAt`, contract values absent from both stored corpus objects (GCS
stat: write-once 2026-07-22, metageneration 1) and live AV responses
(spot-checked 04-01, 04-23: byte-identical to stored). The baseline was
regenerated via `--write-asset` with a `provenance` block (per-date object
path, envelope `generatedAt`, payload sha256). Regenerated output is
byte-identical to the live Firestore shard — pipeline is deterministic
and idempotent on stable inputs. AC#1 and AC#2 are now literally met
(21/21 identical days, rolls match).

### Standards

Hard violations — all **fixed**:

- SPEC doc stale example: `2026-04-14` shown as `no_chain`/617.80 while the
  regenerated baseline has a pick there → replaced with an explicitly
  illustrative miss shape.
- SPEC doc roll narrative ("May-15 → Jun-19 on Apr 23") contradicted the
  regenerated golden (May-29 → Jun-05) → corrected.
- Stray unmatched code fence in the verify guide → removed.
- TEST doc J1 "validated prototype example" → updated to describe the
  regenerated, provenance-stamped baseline.

Judgement calls — accepted as designed:

- Third copy of the SPEC selection rule (production picker, #221 oracle,
  #226 `selectWinner`): intentional independent-oracle design; a new
  **drift-guard test** asserts `pickCellsForDate` and `specWinner` agree
  on six fixture chains, pinning them together in CI.
- `fakeDb` duplicates the established test fixture shape (verbatim from
  `pick-materialize.service.test.ts`) — convention-consistent.
- `as unknown as` casts mirror test/reflection conventions; flagged.
- `run-all.ts` registration includes an ADC/prod-read script — consistent
  with #221 precedent, inconsistent with #220/#225 exclusion; noted.
- `PickCellSpec` was a duplicated type → now a type alias of `PickCellInput`.

Contract baseline: clean (`readItem` narrowing, `getObjectPath`,
`cellYearDocPath` segment count, admin init pattern, `fakeDb` covers
exactly `mergeDayEntries`' tx surface).

### Spec

- **AC#1/AC#2 — met literally** after the baseline regeneration; the gate
  now proves determinism + live parity (0 diffs vs live shard).
- **AC#3 — met**: every original mismatch root-caused and documented in
  `options-data-226-golden-picks.md`; data corrected (invalid baseline
  replaced with production output + provenance).
- **AC#4 — met**: script + guide under `functions/scripts/verify/`,
  registered in README + run-all.
- Classifier overclaim **fixed**: `repaired-gap` (miss→pick) now verifies
  the new pick is the SPEC winner — an unverifiable transition classifies
  `regression`/`unexplained`. `close-only`/`miss-detail` docs now state
  honestly which checks are shape-only.
- `--write-asset` degenerate-baseline hole **fixed** (see Thermo-nuclear).
- Scope creep assessment: `--write-asset`, `provenance`, live cross-check
  exceed the literal ACs but are the documented AC#3 resolution —
  justified.

### Thermo-nuclear

MAJOR findings — all **fixed**:

- **Bless path verified existence, not correctness** — `--write-asset` now
  (a) asserts every date has a FOUND chain, (b) verifies every blessed
  pick is the `specWinner` oracle's winner (and every blessed miss has
  none), (c) refuses to write if any day classifies `regression`/
  `unexplained` vs the current baseline. "Never run to silence a diff" is
  now enforced in code, not just a comment.
- **Third selection-rule copy, no drift guard** — mitigated by the new
  oracle-vs-production agreement test (6 fixture chains; full oracle
  extraction across #221 deferred — flagged for a future refactor).
- **Provenance was write-only** — the runner now compares recorded
  `corpusInputs` sha256s against freshly-loaded envelopes every run and
  prints `INPUT-DRIFT` lines; "did inputs change" is a checksum compare.

MINOR — addressed: untested branches now covered (28 tests, was 15 —
miss→pick regression, null-chain paths, oracle tie-breaks, `diffEntries`
direction, drift guard); dead `??` fallback removed; `LIVE-DOC` output
splits missing-days vs field-diff counts; `listCorpusDates` stub now
throws to prove non-invocation.

JUDGEMENT — `underlyingClose` in the strict gate: corpus objects are
write-once, but `underlyingClose` comes from `symbol-data` bars whose
immutability is unverified (AV re-derives adjusted closes on corporate
actions). AC#1 explicitly includes close fields, so the gate stays strict;
a legitimate close re-derivation classifies `close-only` → re-bless via
`--write-asset`. Documented as an accepted operational cost.

### Test results

- `npx jest` full suite: **106 suites / 1,209 tests green** (includes the
  new 28-test classifier suite).
- `npx tsc --noEmit`: clean.
- Script run vs prod: `identical=21`, `INPUTS: 0/21 drifted`,
  `LIVE-DOC: 0 missing days, 0 field diffs` — PASS.

### Verdict

**PASS** — next step: `/proj qa 213 226`.

**Topic:** Swing-driven options corpus platform
**Topic Slug:** swing-driven-options-corpus
**Thread:** Options corpus ingest
**Thread Slug:** options-corpus-ingest
**Blueprint:** #149 (BE Blueprint)
**Task:** #161 (Dates-only corpus swing doc + single dev2 config)
**Thread Parent:** #106
**Topic Parent:** #102
**Domain:** OPTIONS-DATA
**Type:** CODE-REVIEW
**Status:** Complete
**Created:** 2026-09-26
**Last Updated:** 2026-09-26

# Code Review — Task #161: dates-only swing doc, single config, drop partner endpoint

## Scope reviewed

`SwingSetDoc` slimmed to `{symbol, paramsId, config, pivotDates[],
currentExtremeDate, currentDirection, generatedAt, source}`;
`CANONICAL_ZIGZAG_CONFIGS` replaced by `CORPUS_ZIGZAG_CONFIG` (dev2/L2/R2);
generation/sweep/planner collapse to one doc per symbol;
`partnerSwingSetsV2` removed.

## Standards

- **Doc shape is honest.** `upsert` is a full non-merge `set`, so
  regeneration also deletes fields dropped from the previous shape — no
  stale-field residue.
- **Deriving `currentExtreme` at write time** keeps `getCurrentSwing` a
  straight read and preserves the old projection-vs-last-pivot semantics
  (`currentDirection` mirrors the prior derivation: projection `isHigh`→'up',
  else opposite of last pivot).
- **Planner interim semantics preserved.** `currentExtremeDate` is treated
  as interim only when it isn't already a confirmed pivot — identical
  dedup/precedence behavior to the old `projection` read.
- **Freshness check simplified correctly.** `swingSetsAreFresh` now requires
  exactly the corpus paramsId within TTL — single-doc semantics matches the
  single-doc write.
- Tests/scripts/verify guides updated consistently; obsolete docs carry
  SUPERSEDED notices → `102-107-DECISION-swing-doc-slim-shape.md`.

## Spec

- ✅ SA needs only pivot dates for corpus ingest — the doc stores dates only.
- ✅ ST keeps its existing implementation — no SA read path remains for swing data (`partnerSwingSetsV2` deleted, not just slimmed).
- ✅ One config suffices — dev2's pivot set covers every ≥2% extreme; coarser configs added no dates.
- ✅ Amplitude coverage preserved — corpus seeds land on every extreme date.

## Findings

- Pre-existing `options-swing-sets` docs (old fat shape) are tolerated: the
  planner sees `pivotDates` absent → no coverage until regeneration; the
  nightly sweep/backfill rewrites them slim. Deployed `partnerSwingSetsV2`
  is removed by the next `firebase deploy` (deleted export).

## Verdict

**PASS** — honest end-state code: SA stores the extraction output the corpus
actually consumes, no served artifact, no dead multi-config machinery.

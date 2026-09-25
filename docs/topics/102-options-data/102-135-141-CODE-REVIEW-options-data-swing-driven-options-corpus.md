**Topic:** Swing-driven options corpus platform
**Topic Slug:** swing-driven-options-corpus
**Thread:** Symbol flags curation
**Thread Slug:** symbol-flags-curation
**Blueprint:** #135 (BE Blueprint)
**Task:** #141 (Batch-enable admin script)
**Thread Parent:** #105 (Symbol flags curation)
**Topic Parent:** #102 (Swing-driven options corpus)
**Domain:** OPTIONS-DATA
**Type:** CODE-REVIEW
**Status:** Approved
**Created:** 2026-09-25
**Last Updated:** 2026-09-25

# Code Review — Task #141: Batch-enable admin script

## Scope reviewed

- `functions/scripts/admin/enable-options.ts` (new, 135 lines)
- `functions/scripts/admin/README.md` (new)
- Delegation path: `functions/src/v2/symbol-flags/functions/set-options-enabled.core.ts` (`handleSetOptionsEnabled`) → `functions/src/v2/swing-set/handlers/generate-swing-sets.core.ts` (`enqueueSwingSetGeneration`)
- Convention reference: `functions/scripts/backfill/backfill-optionable.ts`

## Standards

No hard violations. 145-line single-purpose script; `@shared` constants (no duplicated literals); `require()`/admin-init/arg-parser/summary conventions identical to `backfill-optionable.ts`; `enqueueSwingSetGeneration(db, s)` call verified against its real `(db, symbol)` signature.

Judgement calls found and **remediated**:

- ~~Duplicated gate logic in `classify()`~~ → **fixed**: dry-run now runs `handleSetOptionsEnabled` against a `FirestoreLike` wrapper whose `doc.set` is a no-op and a stubbed `enqueue`. The dry-run result IS the governed decision — gate, symbol-regex validation, and probe-error diagnostics included — so it cannot drift from the live path. `classify` deleted.
- ~~`INVALID_ARGUMENT` bucketed as `notOptionable`~~ → **fixed**: summary buckets are now explicit per `errorCode`; unexpected error codes count as `Errors`.
- ~~README missing exit-code 2~~ → **fixed**.

## Spec

Issue #141 + IMPL §5. All acceptance criteria met:

- non-optionable reported and skipped — via core `OPTIONS_NOT_OPTIONABLE`, counted separately.
- already-enabled skipped (idempotent) — core no-op on same value; counted separately.
- history + enqueue per symbol — delegated to the governed core (`changedBy: 'admin-script'`, `false→true` enqueue only).
- `--dry-run` writes nothing — no-op `set` wrapper + stub enqueue; verified live against prod.
- README/usage doc — `functions/scripts/admin/README.md`.

Minor scope addition: `--symbols-file` flag (not in issue) — justified for Windows operator use, documented, ~10 lines.

## Thermo-nuclear

Initial pass flagged one **major** (dry-run shadowing the core gate in `classify` — drift risk) and recommended the dep-injection refactor that was applied. Post-remediation state: no structural regressions, no missed code-judo move (the wrapper *is* the judo move — it deletes the parallel decision tree entirely), sequential loop correct for ordered logs and small operator batches, file size and layer placement correct.

## Test results

- Full Functions suite: **64 suites / 621 tests — all pass**.
- `tsc -p scripts/tsconfig.json` clean.
- Live prod `--dry-run` smoke: `AAPL → would enable`, `BRK-B → not-optionable (optionable=absent)`, `ZZZZ_FAKE`/`BAD!!SYM` → `INVALID_ARGUMENT` counted as Errors. All four outcome paths exercised; nothing written.

## Findings by severity

| Severity | Finding | Disposition |
|---|---|---|
| major | dry-run duplicated core gate logic | Fixed — dep-injection dry-run |
| minor | error bucketing lumped INVALID_ARGUMENT into not-optionable | Fixed — per-errorCode buckets |
| minor | README omitted exit-code 2 | Fixed |
| nit | `--symbols-file` speculative generality | Kept — documented, cheap |

## Verdict

**PASS** — all ACs, all axes clean post-remediation. Final-state re-review of the rewritten file confirmed: dry-run provably cannot reach real Firestore (traced — the core's only write is `ref.set`, no-opped; enqueue is a stub), error buckets are correct per errorCode, no dead code or new issues. Ops note: run `backfill-optionable.ts` (Task #143) before bulk-enabling — unprobed symbols report as not-optionable by design.

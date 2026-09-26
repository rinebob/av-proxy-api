**Topic:** Swing-driven options corpus platform
**Topic Slug:** swing-driven-options-corpus
**Thread:** Options corpus ingest
**Thread Slug:** options-corpus-ingest
**Blueprint:** #149 (BE Blueprint)
**Task:** #152 (De-pilot Stage 1 seed + Stage 2 build)
**Thread Parent:** #106
**Topic Parent:** #102
**Domain:** OPTIONS-DATA
**Type:** CODE-REVIEW
**Status:** Complete
**Created:** 2026-09-25
**Last Updated:** 2026-09-26

# Code Review — Task #152: de-pilot seed + ts-build

## Scope reviewed

- `ts-build.core.ts` (new — testable seam, `handleTsBuildTask`)
- `ts-build.task.ts` (thin `onTaskDispatched` wrapper over the core)
- `ts-build.task.test.ts` (new, 4 task-handler tests)
- Cross-check of the full Stage 1/Stage 2 path for residual symbol restrictions (all removed in #150).

## Findings and remediation

### Verified clean

- Gate → build → done-log → missing-warn → error+rethrow order faithful to the pre-refactor body; rethrow preserves the 3-attempt Cloud Tasks retry.
- Seam matches the `generate-swing-sets.core.ts` convention; wrapper constructs service + gate per invocation.
- No residual symbol restrictions: nightly lists `optionsEnabled==true` docs, pilot filters explicit requests, seed + ts-build gate per-symbol; GCS hit still yields `apiCalls: 0`.
- Seed task handler needs no seam — pure dep-wiring over the already-tested `seedCorpusItem`.

### Accepted (pre-existing, not introduced by #152)

- **`notifySeedSuccess` swallows ts-build enqueue errors** (`corpus-seed.worker.ts`) — a failed enqueue silently drops the Stage-2 build with no retry (seed already 'stored', `maxAttempts:1`). The #154 verification pass / "reconcile only missing items" flow is the natural place for a reconcile path — flagged into that task's scope.
- Gate call sits outside the try in `ts-build.core.ts`, so a gate-throw skips the 'failed' log (still retries) — faithful to original.

### Test coverage

4 tests assert meaningful handler behavior (arbitrary symbol build, disabled skip, missing-date warn, retry propagation). Worker-level + gate tests cover the seed path.

## Verdict

**PASS** — de-piloting complete: Stage 1 + Stage 2 are symbol-generic, gate-enforced, and the previously untestable handler now has a seam.

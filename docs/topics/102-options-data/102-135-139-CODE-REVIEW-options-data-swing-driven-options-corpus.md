**Topic:** Swing-driven options corpus platform  
**Topic Slug:** swing-driven-options-corpus  
**Thread:** Symbol flags curation  
**Thread Slug:** symbol-flags-curation  
**Issue:** #135 (BE Blueprint)  
**Task:** #139  
**Thread Parent:** #105  
**Topic Parent:** #102  
**Domain:** OPTIONS-DATA  
**Type:** CODE-REVIEW  
**Status:** Approved  
**Created:** 2026-09-25  
**Last Updated:** 2026-09-25  

# Code Review — Task #139: Ingestion defaults + on-add probe trigger

## Scope reviewed

- `functions/src/v2/symbol-flags/utils/options-flag-defaults.ts` (new — `withOptionsFlagDefaults`)
- `functions/src/v2/symbol-flags/triggers/symbol-ready.core.ts` (new — `handleSymbolReadyTransition`)
- `functions/src/v2/symbol-flags/triggers/on-symbol-ready.function.ts` (new — `onDocumentUpdated` wrapper)
- `functions/src/v2/common/functions/save-tracked-symbol.function.ts` (defaults applied pre-write)
- `functions/src/index.ts` (`onSymbolReady` export)
- `functions/tests/v2/symbol-flags/ingestion-defaults.test.ts` (11 tests)
- `functions/scripts/verify/options-data-139-on-add-probe.{ts,md}`

## Findings and remediation

### Remediated during review

- **🔴 Missing `secrets` on the trigger (blocking):** `onSymbolReady` declared no `secrets`, so `ALPHAVANTAGE_API_KEY` would never be injected and every probe would end `probe-failed`. Fixed: `{document, secrets: ['ALPHAVANTAGE_API_KEY']}` per repo convention (`on-symbol-added.function.ts:142`).
- **Wildcard param renamed** `{symbolId}` → `{symbol}` to match the sibling trigger.
- **docId-authoritative symbol resolution:** core previously preferred `after.symbol` over the doc id — a disagreeing field would probe/persist the wrong doc. Now doc id is authoritative.
- **Race comment added** to `saveTrackedSymbol` get→set window (mirrors `persist()`).
- **Outcome observability:** wrapper logs the transition outcome per invocation.

### Verified clean (all axes)

- **Spec:** all 5 ACs met. `→READY` gate + `optionable`-absent check = effective once-per-symbol (quota failure intentionally leaves the flag absent for retry; `optionable=false`+`optionableProbeError` marks a failed probe). Both READY writers (`on-symbol-added` equity+non-equity paths, `company-overview-onboarding` task) stamp via `set` on an existing doc → `onDocumentUpdated` catches all current paths.
- **Self-collision:** `probeAndPersist`'s write re-fires the trigger once → `skipped-no-transition`; no loop, one cheap extra invocation.
- **Concurrent transitions:** serialized commits + identical-write dedupe mean at most one `≠READY→READY` event; a rare duplicate delivery double-probes idempotently — benign.
- **Independent defaults:** caller-set `optionsEnabled=true` survives while history still defaults — enable-at-ingestion + enqueue path consistent.

### Accepted (documented, non-blocking)

- **Bulk-import bypass:** `bulkImportSymbolsV2` writes tracked docs directly — flags stay absent until the probe trigger stamps defaults via `probeAndPersist` (which patches them). Documented gap → #143 backfill covers the rest.
- **get→set clobber window** on `optionsEnabled` — narrow, same accepted risk as `persist()`; documented in code.
- `as any` on test fixture; extra `docRef.get()` read per save (+10-30ms) — accepted, documented.

## Test results

- 11 new tests; 25/25 symbol-flags suite; **604/604** full functions suite; `tsc --noEmit` clean.
- Verify script PASS on prod: defaults helper, no-transition skip, already-probed skip, real unprobed→READY probe round-trip.

**Deploy note:** `onSymbolReady` is a new function — requires `firebase deploy --only functions` before it exists.

## Re-review (second pass)

All first-pass findings verified fixed on all three axes; no new issues.

- `secrets: ['ALPHAVANTAGE_API_KEY']` confirmed correct v2 options-object signature; lazy `getAlphaVantageApiKey()` resolves after injection (service constructed inside the handler).
- `{symbol}` param + `event.params.symbol` consistent with `onSymbolAdded`.
- docId-authoritative resolution proven strictly better — `saveTrackedSymbol` stores the client-supplied `symbol` field un-uppercased, so `after.symbol` could have targeted a nonexistent doc.
- Minor polish applied: empty-docId early return in the core.
- Accepted: `console` logging matches sibling trigger precedent (`onSymbolAdded` uses `console.log`); probe-failure logged once in core + outcome line in wrapper; `createNoOpThrottle` means a bulk-READY burst issues unthrottled AV calls — quota failures land `probe-failed`, flags stay absent, covered by next update or the #143 backfill.

## Verdict

**PASS** — re-review confirmed all fixes; no remaining blockers.

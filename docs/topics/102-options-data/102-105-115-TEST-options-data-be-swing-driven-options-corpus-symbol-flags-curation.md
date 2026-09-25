**Topic:** Swing-driven options corpus platform  
**Topic Slug:** swing-driven-options-corpus  
**Thread:** Symbol flags curation  
**Thread Slug:** symbol-flags-curation  
**Issue:** #115  
**Thread Parent:** #105  
**Topic Parent:** #102  
**Domain:** OPTIONS-DATA  
**Type:** Test Plan (BE)  
**Status:** Draft  
**Created:** 2026-09-24  
**Last Updated:** 2026-09-24  

# Test Plan (BE) — Symbol flags curation

## Unit tests

- `OptionableProbeService.probe`: mocked retrieval — non-empty `data` → `optionable=true` + summary (incl. `expirations` count); `data:[]` → `false`; retrieval throws → error propagates to `probeAndPersist` which writes `optionable=false` + `optionableProbeError`. Non-finite summary values omitted.
- `probeAndPersist`: writes `optionable`/`optionableCheckedAt`/`optionableProbeSummary`; patches `optionsEnabled:false`/`optionsEnabledHistory:[]` only when absent (never clobbers an existing `true`).
- `setOptionsEnabledV2`: unauthenticated → rejected; `enabled=true` on `optionable!==true` → `OPTIONS_NOT_OPTIONABLE`; `false→true` → history append `{enabled,changedBy,reason?}` + enqueue called; `true→false` → history append, no enqueue; same-value → success no-op, no history entry.
- `onSymbolReady` trigger: fires only on `→READY` transition when `optionable` absent; skips non-transitions and already-probed docs; probe failure writes `optionable=false`+error and resolves (no throw → no retry storm).
- `saveTrackedSymbol` defaults: new doc gets `optionsEnabled:false`+`optionsEnabledHistory:[]`; re-save of existing doc does not overwrite an existing `optionsEnabled:true`.
- `enable-options.ts`: per-symbol — optionable→enabled+history+enqueue; non-optionable→skipped; already-enabled→skipped; `--dry-run` writes nothing.
- List filter: `optionsEnabled=true`/`optionable=false` params filter the result set.

## Integration (verify scripts, prod-safe)

- `options-data-105-*` verify scripts per task (pattern: `scripts/verify/`): probe service round-trip on one real symbol (mutating — write+cleanup or use a scratch symbol); `setOptionsEnabledV2` emulator or callable-level test; trigger test via emulator `onDocumentUpdated` or extracted handler with fake event.
- Backfill script regression: `--symbols` subset re-run after refactor still probes, skips already-probed, patches defaults.

## Edge cases

- Delisted/invalid symbol → AV `{}`/`Information` → probe throws → `optionable=false`+error (documented behavior; ambiguous responses are not stamped false by silence — the error field records why).
- `Information`/`Note` quota responses → abortable classification preserved in the script's `isAbortable`.
- Trigger self-loop: probe's own write must not re-trigger probing.
- Enqueue failure inside `setOptionsEnabledV2` → warn, save still succeeds.

## Seams

- `HistoricalOptionsRetrievalService` injected into the probe service (mockable).
- Callable handler extracted to a testable core taking deps (`enqueue`, `db`, `now`).
- Trigger core extracted (`handleReadyTransition(event, deps)`).

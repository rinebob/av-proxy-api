**Topic:** Swing-driven options corpus platform  
**Topic Slug:** swing-driven-options-corpus  
**Thread:** Symbol flags curation  
**Thread Slug:** symbol-flags-curation  
**Issue:** #115  
**Thread Parent:** #105  
**Topic Parent:** #102  
**Domain:** OPTIONS-DATA  
**Type:** Test Plan (FE)  
**Status:** Draft  
**Created:** 2026-09-24  
**Last Updated:** 2026-09-24  

# Test Plan (FE) — Symbol flags curation

## Component tests (`symbol-manager.component.spec.ts`)

- Options Enabled checkbox is disabled when `optionable` is `undefined`/`null`/`false`; enabled only when `true`.
- Click → confirm dialog opens; confirm → `setOptionsEnabled` called with `{symbol, enabled, reason}`; cancel → no call.
- Success → row shows checked + snackbar; callable error → snackbar error + checkbox reverts.
- Optionable column renders Yes/No/— (existing tri-state — already covered).
- Sorting still works on both flag columns (existing accessors).

## On-add prompt

- After `addSymbols` success, when the new row's `optionable` resolves `true` → prompt dialog appears; confirm → `setOptionsEnabled(symbol, true)` called.
- `optionable=false` → no prompt.
- Bounded watch times out silently (no prompt, no error).
- Mock the poll/doc-read seam — no real Firestore.

## Service tests

- `SymbolManagerService.setOptionsEnabled` maps to the `setOptionsEnabledV2` callable with correct payload; error surfaces.
- Store `updateSymbolFlag` patches the row in `v2Symbols` (sort/filter pipeline re-runs).

## Edge cases

- Checkbox disabled state vs sorting: disabled checkbox must not swallow header clicks (separate elements — trivially fine).
- Enabling while a sort by `optionsEnabled` is active → row re-sorts live.

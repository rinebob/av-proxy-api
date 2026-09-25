**Topic:** Swing-driven options corpus platform  
**Topic Slug:** swing-driven-options-corpus  
**Thread:** Symbol flags curation  
**Thread Slug:** symbol-flags-curation  
**Issue:** #115  
**Thread Parent:** #105  
**Topic Parent:** #102  
**Domain:** OPTIONS-DATA  
**Type:** Implementation Plan (FE)  
**Status:** Draft  
**Created:** 2026-09-24  
**Last Updated:** 2026-09-24  

# Implementation Plan (FE) — Symbol flags curation

## Scope

Wire the two flag columns (added read-only/disabled in #101) to the real curation path: a per-symbol enable toggle and the on-add enable prompt. Everything is auth-only — no role gating (single-operator app).

## Components

### 1. Options Enabled toggle

- `MatCheckbox` in the Options Enabled column becomes interactive **only when `optionable===true`** — stays disabled otherwise (`[disabled]="symbol.optionable !== true"`), so a non-optionable symbol can never be enabled from the UI.
- Click → confirm dialog (MatDialog): "Enable options corpus for {SYMBOL}?" with optional reason input; when unchecking: "Disable options corpus for {SYMBOL}?". `matTooltip` on the disabled checkbox explains why.
- On confirm → `SymbolManagerService.setOptionsEnabled(symbol, enabled, reason?)` → new callable `setOptionsEnabledV2` → on success patch the row in `v2Symbols` (store method `updateSymbolFlag(symbol, optionsEnabled)`), snackbar confirm; on `OPTIONS_NOT_OPTIONABLE`/error → snackbar error, revert checkbox.
- The Optionable column stays read-only — it displays `optionableProbeSummary`-derived state (Yes/No/—).

### 2. On-add enable prompt

After `addSymbols` succeeds for a symbol, the row's `optionable` is `undefined` until the on-add probe lands. FE: after the add-success snackbar, watch the symbol's row until `optionable !== undefined` (poll the single doc via a bounded effect/interval — max ~2 min, then give up silently). When it resolves `true` → MatDialog "X has listed options — enable options corpus?" → same `setOptionsEnabled` path. Resolves `false`/`null` → nothing.

- Bounded polling only; no persistent listener. Give up without user-facing noise — the column still shows the result.

## Data flow

```
Symbol Manager table
  └─ Options Enabled checkbox (disabled unless optionable===true)
        └─ confirm dialog → SymbolManagerService.setOptionsEnabled
              └─ callable setOptionsEnabledV2 → row patch + snackbar
Add-symbol flow
  └─ addSymbols success → bounded watch on row.optionable
        └─ ===true → enable prompt dialog → setOptionsEnabled
```

## Risks

- **Race**: user enables before the probe lands (`optionable===undefined` → checkbox disabled) — prevents premature enable; the on-add prompt covers the common case.
- **Doc echo**: `setOptionsEnabledV2` is the only toggle path; FE never writes the flag via `saveTrackedSymbol`.

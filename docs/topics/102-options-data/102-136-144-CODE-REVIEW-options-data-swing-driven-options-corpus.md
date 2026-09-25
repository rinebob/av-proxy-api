**Topic:** Swing-driven options corpus platform
**Topic Slug:** swing-driven-options-corpus
**Thread:** Symbol flags curation
**Thread Slug:** symbol-flags-curation
**Blueprint:** #136 (FE Blueprint)
**Task:** #144 (Wire Options Enabled checkbox to setOptionsEnabledV2)
**Thread Parent:** #105 (Symbol flags curation)
**Topic Parent:** #102 (Swing-driven options corpus)
**Domain:** OPTIONS-DATA
**Type:** CODE-REVIEW
**Status:** Approved
**Post-review change:** user removed the optional-reason input — the dialog is now a plain confirm (dedicated component kept; dialog returns `true`/cancel). Specs updated; suite re-verified 38/38 green.
**Created:** 2026-09-25
**Last Updated:** 2026-09-25

# Code Review — Task #144: Options Enabled checkbox wiring (FE / SA UI)

## Scope reviewed

- `src/app/feat/data-maintainer-view/common/fe-common-dm-api.ts` (`SET_OPTIONS_ENABLED_V2` enum)
- `src/app/common/fe-common-app.ts` (PROD_URLS entry — map is exhaustively indexed)
- `src/app/feat/symbol-manager-view/services/symbol-manager.service.ts` + new `.spec.ts`
- `src/app/feat/symbol-manager-view/store/symbol-manager.store.ts` (`updateSymbolFlag`, `setOptionsEnabled`)
- `src/app/feat/symbol-manager-view/components/symbol-manager/symbol-manager.component.{ts,html,spec.ts}`
- `src/app/feat/symbol-manager-view/components/options-enabled-dialog/` (new confirm dialog + spec)

## Standards

No hard violations. Callable name matches the deployed export; `SetOptionsEnabledRequest/Result/ErrorCode` imported from `@shared/alpha-vantage` (no FE/BE mirroring); `HttpsError.details.errorCode` consumption verified against `set-options-enabled.errors.ts`. Judgement calls: service file ~648 lines (pre-existing §1 smell, noted); `updateSymbolFlag` name kept per the impl plan; spec test seams (`as any` swaps) pragmatic — verified necessary: MatDialog/MatSnackBar are provided by the standalone component's own `imports`, so TestBed provider overrides demonstrably do not reach them (empirically confirmed — real MatDialog ran under an override attempt).

## Spec

All four ACs met: disabled unless `optionable===true` (template binding + defensive re-guard, covers absent/false); confirm dialog with optional trimmed reason → `{symbol,enabled,reason}`; success patches row (transitioned only), cancel/error reverts checkbox + snackbar; component/service/dialog specs cover every path. On-add prompt correctly absent (#145).

## Thermo-nuclear

No blockers. Revert-via-`event.source.checked` verified as the correct MatCheckbox pattern (`[checked]` binding won't re-fire; change fires post-toggle). Dedicated dialog justified (reason input, dynamic copy). `afterClosed`/`from(promise)` subs complete — no leak.

## Remediated during review

- **Store patched request `enabled`, not server result** (all three axes) → now `result.optionsEnabled ?? enabled`.
- **Idempotent no-op showed misleading "enabled" snackbar** → distinct "was already enabled/disabled" message + visual revert; regression test added.
- **Unnecessary `symbol.symbol!`** → dropped (symbol is non-optional in `AvSymbol`).

## Test results

- `ng test` (karma/jasmine): **39/39 symbol-manager-view specs pass** (16 new across service/component/dialog). Full suite 130/133 — 3 failures are pre-existing unrelated auth smoke tests (`StockDataComponent`, `LoginComponent`, `AuthService` "should create" — Firebase injection issues untouched by this change).
- `ng build` clean; `build:shared` clean.

## Findings by severity

| Severity | Finding | Disposition |
|---|---|---|
| minor | patch used request value, not server result | Fixed |
| minor | misleading success snackbar on no-op | Fixed |
| nit | `symbol.symbol!` unneeded | Fixed |
| nit | service file size (§1, pre-existing) | Deferred — noted |
| nit | errorCode not enum-validated | Deferred — low risk |

## Verdict

**PASS** — all ACs on all three axes post-remediation. Manual click-through against prod pending (user QA step).

**Topic:** IV time series  
**Topic Slug:** iv-time-series  
**Thread:** IV history for all tracked symbols  
**Thread Slug:** iv-history-tracked-symbols  
**Issue:** #173  
**Task:** #173  
**Thread Parent:** #159  
**Topic Parent:** #158  
**Domain:** OPTIONS-DATA  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-27  
**Last Updated:** 2026-09-27  

# Code Review — Task #173: IV metrics production verify script

## Scope reviewed

- `functions/scripts/verify/options-data-173-iv-metrics-endpoint.ts` (new)
- `functions/scripts/verify/options-data-173-iv-metrics-endpoint.md` (new)
- `functions/scripts/verify/README.md` (#173 row)

## Findings (three axes) + resolutions

- **[Standards] Missing `--include-email`** in the token-mint examples —
  without it the impersonated token carries no `email` claim and every
  authed check would 401. Fixed in the script header and guide, with
  rationale.
- **[Thermo] Misleading 401 on misconfigured endpoint** — a 500 (unset
  `EXPECTED_GOOGLE_AUDIENCE`) now gets an explicit diagnostic instead of
  a wrong-looking 401 assertion.
- **[Thermo] Weak `metrics=` assertion** — now asserts every row key ⊆
  {date, iv30}, catching filter leaks regardless of stored fields.
- **[Thermo] `ZZZXQ` could become tracked** — untracked probe now scans a
  candidate list against `tracked-symbols` and picks the first absent doc.
- Spec axis: all ACs verified — month-range derivation edge cases clean,
  literal collection/field names match shared constants, float `===` safe
  (JSON roundtrip bit-exact), README row accurate.
- Auth-env contract differs from #142 (env token vs in-script mint) —
  documented as deliberate: operator supplies the token so the same script
  works with or without impersonation rights.

## Round 2 (convergence)

All four fixes verified landed correctly. **NO FINDINGS.**

## Verdict

**PASS** — task → QA. Production run blocked on endpoint deployment +
operator token.

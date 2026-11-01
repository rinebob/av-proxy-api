**Topic:** Options Corpus Bulk Ingest  
**Topic Slug:** options-data  
**Thread:** Full-Date Corpus Backfill (2026)  
**Thread Slug:** corpus-backfill-2026  
**Issue:** #218  
**Thread Parent:** #214  
**Topic Parent:** #213  
**Task:** #225  
**Domain:** BE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-01  
**Last Updated:** 2026-11-01  

## Re-review — Pass 2 (post-remediation final diff)

All three axes re-ran against the final state. **Spec: CLEAN** (all five ACs
met, no regressions — symbol narrowing can't shrink the served universe since
the writer uses the same codec). **Thermo-nuclear: APPROVED** — all pass-1
majors verified fixed; remaining items are INFO-level edge armor outside the
endpoint's threat model. **Standards: all six remediations verified**;
residual minors all fixed in this pass:

- minor — discovery doc `updatedAt` showed `<serverTimestamp>` placeholder;
  wire emits ISO-8601/`null`: **fixed** (doc now shows the real format).
- minor — discovery doc didn't document the symbol alphabet (dotted tickers
  rejected): **fixed** (`BRK-B`, not `BRK.B`).
- minor — verify guide sample output + script header comment missing the
  dotted-symbol check added during remediation: **fixed**.
- low/theoretical — `PICK_CELL_SYMBOL_PATTERN` has no length bound; a >32-char
  symbol is unreachable past the optionsEnabled gate: **noted only**.
- INFO — `days`/`expiry` pass by reference (no mutation risk — `res.json`
  serializes synchronously); `{_seconds}` proto-JSON → `null` (defensive);
  missing stored field → absent key rather than 500 (writer contract makes
  it unreachable).

**Final verdict: PASS** — suite 105/1,193 green; prod verify all-PASS.

## Pass 1 — initial review (findings → remediation below)

Change set (all uncommitted work-in-progress):

- `src/v2/partner/options-delta-picks-partner.ts` — handler + `partnerOptionsDeltaPicksV1`
- `src/v2/partner/options-delta-picks-request.utils.ts` — `parseDeltaPicksQuery` (PICK_GRID validation)
- `shared/options/options-delta-picks.types.ts` — `DeltaPicksCellYearResponse` + `DeltaPicksErrorResponse`
- `shared/options/options-delta-picks.utils.ts` — `PICK_CELL_SYMBOL_PATTERN` export
- `functions/src/index.ts` — export (1 line; shared file)
- `firestore.rules` — deny-all on `options-delta-picks/{document=**}`
- `tests/v2/partner/options-delta-picks-{partner,request.utils}.test.ts` — 49 tests
- `scripts/verify/options-data-225-pick-endpoint.{ts,md}` + README/run-all registration
- `docs/partner/options-data/options-delta-picks-discovery.md`

## Axis summaries

### Standards

Structure mirrors `contract-availability-partner.ts` faithfully — deps
interface, `errorResponse`, logger tag, `functionOptions`, and the
405 → auth → parse → gate → read ordering. Doc path is even-segment (verified
by codec round-trip tests + prod read). Findings: **1 major, 4 minor, 5 nits**
— all actionable items fixed in remediation (see below). Inherited
`as unknown as` test casts flagged but match the established convention in
the sibling test file.

### Spec

All five ACs met. AC5's "emulator-backed doc read" judged met via repo
precedent (injected seam + in-memory store, same as the cell-writer tests)
**plus** a prod-read verify script — strictly stronger than an emulator.
Scope-creep items (C/P aliases, ISO-8601 `updatedAt`, `{ok:true}` envelope)
are all documented partner conventions now reflected in the discovery doc.

### Thermo-nuclear

Initial verdict: does not pass — **3 majors** (symbol-alphabet 500, blind doc
spread, prelude duplication ×8). First two fixed; the third deferred as
pre-existing architecture debt (see Deferred). Post-remediation the change
passes the approval bar.

## Findings & remediation

| Severity | Finding | Disposition |
|---|---|---|
| major | `SYMBOL_PATTERN` (admits `.`) vs `buildCellId` (rejects `.`) → enabled dotted symbol → 500 not 400 | **Fixed** — exported `PICK_CELL_SYMBOL_PATTERN` from the codec; parser validates against it. `BRK.B` → 400 proven on the live verify run |
| major | Blind `{ok:true, ...doc}` spread — stored fields not in the wire type could leak; a stored `ok` key could clobber the envelope | **Fixed** — explicit field-list serialization; field-leak test added |
| major | `SA_AUTH as never` in verify script (guidelines §10) | **Fixed** — typed `PartnerDeltaPicksDependencies` |
| major | 405→auth→403→parse prelude duplicated across ~8 partner handlers | **Deferred** — pre-existing architecture debt; consolidating sibling handlers is out of scope (AGENTS.md scope discipline). Mirroring convention was deliberate. Recorded on the QA issue |
| minor | `ContractCatalogErrorResponse` borrowed cross-domain | **Fixed** — `DeltaPicksErrorResponse` alias |
| minor | `toDate()` branch + missing `updatedAt` untested | **Fixed** — both cases added |
| minor | No hyphenated-symbol coverage | **Fixed** — `BRK-B` parse + `BRK-B-put-20-45` serve tests |
| nit | `type` error message + discovery doc omitted accepted `C`/`P` | **Fixed** — message lists all tokens; doc updated |
| nit | `delta=05`/`year=0000` accepted | **Leave** — harmless normalize/404; noted |
| nit | No `gridVersion` check | **Leave** — SPEC: grid changes are additive-only; speculative guard |
| judgement | AC5 emulator vs dep-injection seam | **Met** per repo precedent + stronger prod verification |

## Test results

- Full suite: **105 suites / 1,187 tests green**; tsc clean
- New: 49 endpoint tests (validation matrix, auth gates, doc read, field-leak,
  timestamp branches, hyphenated symbol)
- Prod verify (`options-data-225-pick-endpoint.ts`): all PASS — real
  `QQQ-put-20-45/years/2026` doc served (204 picks / 4 misses / 208 days),
  dotted symbol 400, `OPTIONS_NOT_ENABLED`, missing-shard 404

## Deferred

- **Partner-handler prelude consolidation** — the 405/auth/403/400 skeleton is
  near-verbatim across ~8 handlers; `partner-handler-base.ts` could carry a
  `withServiceAccountGet`-style wrapper. Pre-existing pattern, not introduced
  by this diff — a dedicated refactor task would touch every endpoint.
- **`delta=05`/`year=0000`** — accepted and normalized/404'd; harmless.
- **`gridVersion` mismatch serving** — SPEC declares grid additive-only.

## Verdict

**PASS** — majors fixed or consciously deferred with justification; all ACs
met; suite green; prod-verified.

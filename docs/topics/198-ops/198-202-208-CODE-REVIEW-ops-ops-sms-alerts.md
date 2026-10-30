# Code Review — POST-A Last-Interval Signoff Emission

| Meta | Value |
|---|---|
| **Doc Type** | Code Review |
| **Blueprint** | [#202 — Backend — Ops SMS Alerts — Pipeline SMS Refresh](../../issues/202) |
| **Issue** | [#208 — POST-A last-interval signoff emission](../../issues/208) |
| **Task** | #208 |
| **Topic** | [#198 — Ops SMS Alerts](../../issues/198) |
| **Topic Parent** | #198 |
| **Topic Slug** | ops-sms-alerts |
| **Type** | Code Review |
| **Status** | Complete |
| **Created** | 2026-10-28 |
| **Last Updated** | 2026-10-28 |

## Scope

Task #208 emits exactly one all-intervals POST-A signoff after the DAILY, WEEKLY, and MONTHLY A-pass runs each publish their PDR. `emitPostASignoff` (new `post-ops-signoff.ts`) gates on sequence/runType, reconstructs the three sibling runIds from the triggering runId, requires all three `partnerDataReady.messageSent`, claims `signoff:post:{marketDate}:A` transactionally, and emits `composePostSignoff` via the canonical emitter. Wired into both `realtime-run-aggregator.ts` completion paths after the `messageSent` write; `reconcileRunJobs` now also collects `permanentFailureSymbols`.

## Axis results

| Axis | Verdict |
|---|---|
| Standards | **SHIP** — no hard violations; fail-safe contract, ordering, and conventions verified against the #207 sibling pattern |
| Spec | **PASS** — all 5 ACs MET; reconstruction noted as stricter-than-letter (query would cross-pollinate MANUAL/LIVE) |
| Thermo-nuclear | **REQUEST CHANGES → resolved** — 1 major, 5 minors, 5 nits |

## Findings and dispositions

| Severity | Finding | Disposition |
|---|---|---|
| Major (M1) | **MANUAL/LIVE claim-key collision** — a manual A-pass (`*-MANUAL-POST-1335`) is a distinct identity sharing `signoff:post:{date}:A`; it could claim the key and emit "scheduled work for the day is done" while the LIVE pass runs, then the real signoff suppresses as `already-claimed` and the LIVE-only watchdog sees all-clear | Fixed — post-parse gate on `parts.runType === 'LIVE'`; MANUAL passes emit nothing (matches the watchdog model). Harder than the intraday analogue, where manual runs share the scheduled runId — here they don't |
| Minor (m3) | claim key used the doc `marketDate` field while sibling identity used the runId — a corrupt doc could claim a wrong/other day's key | Fixed — key, text, claim, and emit all derive from `parts.marketDate` (validated by `parseRealtimeRunId`); doc-vs-runId mismatch is warn-logged |
| Minor (m4) | trust asymmetry — gate checked doc fields, identity used runId; a corrupted B-doc could claim the A key | Fixed — gate additionally asserts `parts.sequence === 'A'` && `parts.phase === 'POST'`; runId is authoritative |
| Minor (m6) | reconcile additions effectively untested (mock QuerySnapshot lacked `size`; zero assertions on `permanentFailureSymbols`) | Fixed — `size` added to fixtures; `arrayUnion` write asserted; reconcile-path signoff ordering after `messageSent` pinned |
| Minor (m2) | swallowed failure → silent zero-signoff; no watchdog covers "all PDRs sent but no signoff" | Deferred — by-design fail-safe trade-off; signoff-absence detection belongs to the watchdog task (#210), noted there |
| Minor (m7) | PDR sent + `messageSent` write fails → permanently missing signoff + false `pdr_missing` | Pre-existing ordering hole, #208 inherits it; noted |
| Minor (m5) | sibling counts read non-transactionally; can diverge from PDR payloads post-COMPLETE | Pre-existing; consequence of Bug #235 (post-COMPLETE counter mutation) — tracked there |
| Nit (n1) | run-type literals in 4 places | Fixed — `POST_ALL_INTERVALS_{INITIAL,RETRY}_RUN_TYPE` in `job-config.ts`; aggregator migrated (manager literals untouched — parallel-session file) |
| Nit | `runId as RealtimeRunId` cast + throw-driven parse | Fixed — `isValidRealtimeRunId` type guard |
| Nit | `snap.data() as any` | Fixed — `RealtimeRun` type |
| Nit (n3) | `opsSms.claimed` stamps only the last finisher's doc | Accepted — audit doc carries `siblingRunIds` for the full set |
| Nit | unused `logLines` in new tests | Removed |

## Design caveats (ratified or deferred)

- **Sibling reconstruction over collection query** — deliberate: MANUAL and LIVE A-passes share identical `marketDate`/`sequence`/`runType` doc fields; only the runId distinguishes them.
- **MANUAL A-passes emit nothing** — a manual re-run completing the day produces no signoff; the watchdog model covers LIVE only. If ops wants manual-completion signoffs, that's a follow-up decision.
- **Single-clockPt assumption** — reconstruction assumes the canonical 1335 PT pass; a hypothetical second A-pass clockPt would see perpetual pending (fail-safe direction).
- **Counts in the signoff are post-publish reads** — they can diverge from the PDR payloads under Bug #235's post-COMPLETE increments; correct once #235 lands.

## Evidence

- Focused: **51/51** (18 helper + 10 aggregator new, incl. MANUAL/spoof/canonical-key regressions)
- Full suite: **987/987**, `tsc --noEmit` clean
- Prod verify: **16/16** — partial gate, claim/emit, cross-sibling dedupe, B/C no-op, cleanup

## Second pass (post-remediation re-review)

Re-read the final-state helper and both aggregator call sites for defects
introduced by the M1/m3/m4 fixes.

| Probe | Result |
|---|---|
| LIVE gate placement | Correct — runs before sibling reconstruction; `isManual: parts.runType === 'MANUAL'` is dead-but-harmless (always false past the gate) |
| Doc-field gate (args) vs runId gate | Args gate is an early-out only; a spoofed doc field can pass it but the runId gate is authoritative — cannot widen to a wrong key |
| `marketDate` arg role post-fix | Log/mismatch-check only — a lying doc field warns and the runId date wins; correct |
| Reconcile-path args | `reconciledData.marketDate` feeds the same non-authoritative arg; emit stays inside `try`, after the `messageSent` write |
| Claim-then-emit failure | `emitOpsAlert` failure after a successful claim = silent miss — same fail-safe trade-off already deferred to #210 |
| New findings | **None actionable.** One stale doc-comment (`marketDate` described as alertKey identity — no longer true post-m3) corrected in place |

Post-pass evidence: `tsc --noEmit` clean, 28/28 on the two touched suites
(prior full-suite 987/987 and prod 16/16 already recorded post-remediation).

## Verdict

**PASS — converged.** Second pass produced zero new actionable findings;
remediation held up under re-review. No further pass warranted. Ready for
`/proj qa 198 208`.

# As-Built — Repo & Deploy Hygiene: Firestore index reconciliation

**Topic:** Repo & Deploy Hygiene  
**Topic Slug:** repo-deploy-hygiene  
**Issue:** #133  
**Topic Parent:** #118  
**Domain:** OPS  
**Type:** AS-BUILT  
**Status:** Complete  
**Created:** 2026-09-24  
**Last Updated:** 2026-09-24  

## What was built

`firestore.indexes.json` was reconciled with prod and made the complete source of truth for composite indexes in `alpha-vantage-proxy-api`.

- **Config:** the file was regenerated as a verbatim `firebase firestore:indexes` export — all 78 deployed composite indexes plus the `news.ttl` fieldOverride, in CLI-export format (no explicit `__name__` fields).
- **Verification:** `functions/scripts/verify/ops-119-firestore-indexes.ts` — read-only drift detector that fetches the live index list via `firebase firestore:indexes` and diffs it against the file in both directions, enforces the no-`__name__` format rule, and compares `fieldOverrides` semantically. Registered in `run-all.ts`.
- **Docs:** `firestore.indexes.README.md` rewritten (policy + history); `docs/operations/firestore-indexes-deploy.md` added (incident write-up + add/adopt/delete/diagnose-409 how-to).

## Architecture decisions

- **CLI-export format as the file contract.** Entries carry no explicit `__name__` field — matching the format `firebase firestore:indexes` emits. This is what makes the file machine-diffable against prod and what avoids the deploy-time 409s (explicit `__name__` entries don't match console/error-link-created indexes).
- **Drift is enforced, not just documented.** The verify script fails on prod-only indexes (console/error-link creations) so drift can't silently reaccumulate — the original failure mode.
- **One-time fix rode along:** `contract-summary-aggregator.service.test.ts` had a wrong relative require depth (`../../../src` → `../../../../src`), a pre-existing failure from a2a2b6d. Fixed during the review gate to get the suite green; noted in the code review doc.

## Deviations

- No Blueprint/Phase/Thread stages — the bug task was filed directly under the Topic anchor via `/proj triage`.
- No partner endpoints → no API-REFERENCE doc. Deployment procedure lives in `docs/operations/firestore-indexes-deploy.md` instead of a separate RUNBOOK doc (avoid duplicating the same content).

## Verification

- `firebase deploy --only firestore:indexes` — clean no-op, no 409, no delete prompt.
- `ops-119-firestore-indexes.ts` — PASS (78/78 match, fieldOverrides equal).
- `npm test` — 59/59 suites, 555 tests green.

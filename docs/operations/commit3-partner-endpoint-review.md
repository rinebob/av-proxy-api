# Code Review: Commit 3 — BE-FEAT-PARTNER-LIST-CONTRACTS

**Review date:** 2026-07-24
**Commit message:** `BE-FEAT-PARTNER-LIST-CONTRACTS: add partnerListContractsV2 endpoint`
**Design doc ref:** `docs/operations/storage-file-viewer-design.md` Phase 3

---

## Files in commit

| File | Status | Summary |
|---|---|---|
| `functions/src/v2/partner/list-contracts-partner.ts` | New | Partner-facing HTTPS endpoint for contract discovery |
| `functions/src/index.ts` | Modified | Export `partnerListContractsV2` |
| `firestore.rules` | Modified | Admin read-only rule for `options-file-index` |
| `docs/partner/partner-discovery.md` | Modified | Status updated to "Implemented" |

---

## Standards

### Hard Violations

1. **Documentation mismatch: `type` field value** — `docs/partner/partner-discovery.md:454` shows `"type": "C"` in the example response, but the actual code returns `type: meta.type` which is `'call'` or `'put'` (via `filterContractsByType` → `parseContractResult` → `contract-result.utils.ts:23`). The doc example should show `"type": "call"`.

### Judgement Calls

2. **`HttpsOptions` type defined locally** — `list-contracts-partner.ts:29-34` defines a local `HttpsOptions` type. This pattern is likely duplicated across other partner endpoint files. Not introduced by this commit (pre-existing pattern), but noted.

3. **File length** — 280 lines, well under 500. ✓

4. **Single concern** — The file handles one concern: partner contract listing. Request parsing, auth, Firestore queries, and response formatting are all part of this single concern. ✓

---

## Spec

1. **Auth model** — Service account OIDC + audience verification via `authenticateRequestEither`. Requires `serviceAccountEmail` in auth result (line 111). ✓

2. **Allowed symbols** — `ALLOWED_SYMBOLS = new Set(['QQQ', 'TQQQ'])` (line 21). Matches design doc. ✓

3. **Input validation** — Thorough: symbol presence (124), symbol allowlist (134), expiration format (149), strike numeric (159), type enum (169), and "at least one of expiration or strike" (179). ✓

4. **Three query paths** — Path 1 (expiration only), Path 2 (strike only), Path 3 (both → intersect). No Path 4 (symbol-only), intentionally excluded per validation at line 179. ✓

5. **Uses shared `filterContractsByType`** — Lines 210, 221, 240 all import from `contract-result.utils.ts`. Strike values are correct (no double division). ✓

6. **Firestore rules** — `firestore.rules` adds admin read-only for `options-file-index/{document=**}`. Writes denied (backend uses Admin SDK which bypasses rules). ✓

7. **Function export** — `functions/src/index.ts` exports `partnerListContractsV2`. ✓

8. **Response shape** — `{ ok: true, symbol, contracts, count }`. Matches design doc. ✓ (except `type` field value — see Standards #1)

9. **Error handling** — Try/catch with structured error responses including `requestId`, `code`, and `timestamp`. ✓

10. **Logging** — Request and response logged with `requestId`, symbol, filters, count, and processing time. ✓

---

## Thermo-Nuclear

1. **`db` import path differs from admin endpoint** — Partner endpoint imports `db` from `'../utils/utils'` (line 19), while admin endpoint imports from `'../../../firebase-admin-init'`. Both should resolve to the same Firestore instance, but the divergent import paths are a smell. If `../utils/utils` re-exports from `firebase-admin-init`, this is fine. If it creates a separate instance, it's a bug. **Recommend verifying** that `../utils/utils` re-exports the same `db`.

2. **No Path 4 (symbol-only) for partner endpoint** — Intentional per design (partner endpoint requires at least one filter). The validation at line 179-187 enforces this. ✓

3. **If-chain without `else if`** — Lines 203, 214, 225 are separate `if` statements, not `if-else if`. The conditions are mutually exclusive so only one executes, but this is fragile if someone modifies the conditions later. Minor.

4. **Secrets configuration** — `allowedServiceAccounts` and `expectedGoogleAudience` secrets are defined and referenced in `functionOptions.secrets`. ✓

5. **Memory/timeout** — 256MiB, 30s timeout, 20 max instances. Reasonable for a Firestore-read-only endpoint. ✓

---

## Verdict: Approve with findings

The endpoint is well-structured with thorough validation, proper auth, and correct use of shared utilities. The doc mismatch on the `type` field (Standards #1) should be fixed. The `db` import path (Thermo-Nuclear #1) should be verified.

### Recommended follow-ups (not blocking)
- Fix `docs/partner/partner-discovery.md` example to show `"type": "call"` instead of `"type": "C"`
- Verify `../utils/utils` re-exports the same `db` instance as `firebase-admin-init`

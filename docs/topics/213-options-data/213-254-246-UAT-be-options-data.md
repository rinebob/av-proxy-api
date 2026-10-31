**Topic:** Options Corpus Bulk Ingest  
**Topic Slug:** options-corpus-bulk-ingest  
**Thread:** Contract Availability Endpoint  
**Thread Slug:** availability-endpoint  
**Issue:** #254  
**Thread Parent:** #237  
**Topic Parent:** #213  
**Task:** #246  
**Domain:** BE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-31  
**Last Updated:** 2026-10-31  

# UAT — Task #246: availability endpoint verify script

## Scope

`functions/scripts/verify/options-data-246-contract-availability.ts` — a
read-only verify script that exercises the **deployed**
`partnerContractAvailabilityV1` over HTTPS, plus its `.md` companion,
README row, and run-all registration. Complements
`options-data-244-availability-services.ts` (service-level) by proving the
HTTP surface end-to-end.

## Prerequisites

- `partnerContractAvailabilityV1` **deployed** to prod (the #245 build).
  Check: `gcloud functions describe partnercontractavailabilityv1
  --region=us-central1 --gen2 --project=alpha-vantage-proxy-api` — a 404
  means the live scenarios are blocked on deploy.
- Partner SA needs `run.invoker` on the deployed function (#245 handoff).
- For authed checks, ONE of:
  - `$env:AVAILABILITY_ID_TOKEN` — pre-minted OIDC id token for an
    allowlisted SA (`--include-email`, audience = endpoint URL)
  - `$env:GOOGLE_APPLICATION_CREDENTIALS` — SA key file
  - `$env:SMOKE_SERVICE_ACCOUNT` — SA email (gcloud impersonation;
    caller needs `roles/iam.serviceAccountTokenCreator`)
- `cd functions`.

## Scenarios

### S1 — Typecheck

```
cd functions; npx tsc --noEmit -P scripts/tsconfig.json
```

Expected: clean.

### S2 — Full jest suite

```
cd functions; npx jest
```

Expected: all green (script isn't under jest; proves no collateral).

### S3 — Registration (static)

- `scripts/verify/README.md` — row `#246 | options-data-246-contract-availability.ts` + execution-order entry under Topic #213
- `scripts/verify/run-all.ts` — file in the read-only `SCRIPTS` list
- `scripts/verify/options-data-246-contract-availability.md` — companion doc exists

### S4 — Not-deployed behavior (live URL, no creds)

```
cd functions
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-246-contract-availability.ts
```

Expected while undeployed: `FAIL: endpoint returned 404 — partnerContractAvailabilityV1 is not deployed yet`, exit 1.
After deploy (still no creds): `no token → 401`, `POST → 405 METHOD_NOT_ALLOWED`, then `SKIP: no credentials`, exit 0.

### S5 — Authed live run (requires deploy + SA creds)

```
cd functions
$env:AVAILABILITY_ID_TOKEN = (gcloud auth print-identity-token --impersonate-service-account=<allowlisted-sa> --audiences=<audience-in-EXPECTED_GOOGLE_AUDIENCE> --include-email)
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-246-contract-availability.ts
```

**Audience note (learned in live run):** the token's `aud` must match an
entry in `EXPECTED_GOOGLE_AUDIENCE` — the `run.app` URL is not in the secret.
The base host `https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net`
is, and satisfies the check for any function. App rejects a bad `aud` with
`403 {error:'Forbidden', message:'Google ID token audience mismatch.'}` —
distinct from a Cloud-Run IAM 403 (no app JSON shape).

Expected — every check prints `PASS`, ends `=== All verification checks passed ===`, exit 0:

1. unauthed `GET` → `401`
2. `POST` → `405 METHOD_NOT_ALLOWED`
3. unfiltered GET → `200` + envelope `{ok,symbol,contracts,count,truncated,corpusDates,corpusDateCount}`
4. entry fields `contractId/expiration/strike/type/firstObserved`, `lastUpdated` absent
5. `corpusDates` strictly ascending `YYYY-MM-DD`, `corpusDateCount` consistent
6. `type=<t0>` (from `contracts[0]`) narrows + all entries `t0`
7. `type=<t0>&firstObserved=<d0>` → 200, all entries in-range (exercises `(type,firstObserved)` index)
8. `type=<t0>&strike=<s0>` → 200, exact matches (exercises `(type,strike)` index)
9. 31 `expirations` → `400 BAD_REQUEST`
10. gcloud user token → `403 FORBIDDEN` (or documented SKIP on IAM/env)
11. `type=bogus` → `400` V2 envelope
12. `ZZZNOSUCH1` → `404 OPTIONS_NOT_ENABLED`

### S6 — run-all position (documentation-only)

No execution — confirm `run-all.ts` ordering comment/registration keeps it after `options-data-244`.

## Traceability

| AC | Scenario |
|---|---|
| Script hits deployed endpoint for a known options-enabled symbol | S5 (default `COST`) |
| Envelope shape, contracts non-empty + fields, `corpusDates` sorted, ≥1 filter narrows, `truncated` present | S5 (checks 3–6) |
| Read-only, eligible for run-all | S3 + S6 |
| Companion `.md` + README row + execution-order entry | S3 |
| #245 handoff extras (403, cap, index paths) | S5 (checks 7–10) |

## Results

| Scenario | Result | Evidence |
|---|---|---|
| S1 typecheck | PASS | `tsc -p scripts/tsconfig.json` clean |
| S2 full suite | PASS | 99 suites / 1,085 tests |
| S3 registration | PASS | README row + execution-order entry + run-all `SCRIPTS` entry + `.md` on disk |
| S4 not-deployed | PASS (behaves correctly) | `FAIL: endpoint returned 404 — partnerContractAvailabilityV1 is not deployed yet`, exit 1 — the designed fail-fast |
| S5 authed live run | PASS | Live run vs `partnercontractavailabilityv1-lsluydmucq-uc.a.run.app`, SA `maintenance-bot`, `aud`=cloudfunctions.net base host — 30 PASS / 1 SKIP (check 10, no gcloud user identity in env): `2000` contracts, `533` corpusDates ascending, `type=call` narrows→2000, `expirations` narrows→104, `firstObserved=2019-01-22`→423 via `(type,firstObserved)`, `strike=155`→33 via `(type,strike)`, 31-exp→400, `type=bogus`→400, `ZZZNOSUCH1`→404 OPTIONS_NOT_ENABLED, `lastUpdated` stripped |
| S6 ordering | PASS | registered after `options-data-244` in `SCRIPTS` |

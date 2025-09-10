# Lockdown Invokers Script (Cloud Run HTTPS)

File: `functions/scripts/lockdown-invokers.ps1`

Last updated: 2025-09-10

---

## Overview

This script manages Cloud Run IAM invoker bindings (`roles/run.invoker`) for HTTPS services. It is designed to lock down **partner-only** HTTP endpoints by:

- Removing public invoker (`allUsers`)
- Granting `roles/run.invoker` to a specified service account (typically a partner backend SA)
- Printing the resulting bindings for verification

> Important: Internal/browser-facing gateways must remain publicly invokable for browser CORS preflight and are protected in code by an Origin allowlist. Do NOT include internal endpoints when running this script.

---

## When to Use

- You are onboarding or maintaining a partner HTTP endpoint (server-to-server) and need to restrict who can invoke it at Cloud Run.
- You want a repeatable, scripted way to remove `allUsers` and grant invoker to specific service accounts.

Do NOT use this script for:
- Internal/browser-facing endpoints (e.g., `alphaVantageApiV2`, `benzingaApiV2`, `listSymbolsV2`). These must stay publicly invokable and are protected by an Origin allowlist.
- Non-HTTP functions (callable `onCall`, scheduled `onSchedule`). IAM invoker does not apply.

---

## Internal vs Partner Policy

- Internal browser-facing
  - Keep `allUsers` so preflight can reach the service.
  - Enforce `ALLOWED_ORIGINS` via `withCors` and explicit Origin guard in code.

- Partner server-to-server
  - Remove `allUsers` via this script.
  - Enforce dual-auth (Google OIDC or Firebase ID) with allowlisted service accounts.

---

## Prerequisites

- gcloud CLI installed and authenticated to the target project
- You know the Cloud Run region (e.g., `us-central1`)
- Service account email(s) that should be granted invoker for the partner service

---

## Parameters

- `-ProjectId` (string, required) — GCP project ID, e.g., `alpha-vantage-proxy-api`
- `-Region` (string, required) — Cloud Run region, e.g., `us-central1`
- `-InvokerServiceAccount` (string, required) — Service account email to grant `roles/run.invoker`
- `-Services` (string[], optional) — Explicit list of Cloud Run HTTP service names to target. Defaults to empty (no action). Only include partner HTTP endpoints.

> The script will exit without changes if `-Services` is not provided or empty. This is by design to avoid accidental lock down.

---

## Usage (PowerShell)

Lock down a single partner endpoint:

```powershell
pwsh -File functions/scripts/lockdown-invokers.ps1 `
  -ProjectId alpha-vantage-proxy-api `
  -Region us-central1 `
  -InvokerServiceAccount maintenance-bot@alpha-vantage-proxy-api.iam.gserviceaccount.com `
  -Services 'partner-time-series'
```

Lock down multiple partner endpoints:

```powershell
pwsh -File functions/scripts/lockdown-invokers.ps1 `
  -ProjectId alpha-vantage-proxy-api `
  -Region us-central1 `
  -InvokerServiceAccount maintenance-bot@alpha-vantage-proxy-api.iam.gserviceaccount.com `
  -Services 'partner-time-series','partner-realtime'
```

What it does per service:
- Removes `allUsers` binding (ignore error if binding didn't exist)
- Adds `serviceAccount:<InvokerServiceAccount>` as `roles/run.invoker`
- Prints effective invoker members

---

## Verification

List Cloud Run services (optional):
```bash
gcloud run services list \
  --project=alpha-vantage-proxy-api \
  --region=us-central1 \
  --format="table(NAME,REGION)"
```

Check invoker policy for a service:
```bash
gcloud run services get-iam-policy partner-time-series \
  --project=alpha-vantage-proxy-api \
  --region=us-central1 \
  --format="value(bindings[role=roles/run.invoker].members)"
```

Resolve service URL and test with Google OIDC (service account):
```bash
REGION=us-central1
PROJECT=alpha-vantage-proxy-api
SERVICE=partner-time-series
SA=maintenance-bot@alpha-vantage-proxy-api.iam.gserviceaccount.com

URL=$(gcloud run services describe "$SERVICE" \
  --region="$REGION" --project="$PROJECT" \
  --format='value(status.url)')

ID_TOKEN=$(gcloud auth print-identity-token \
  --audiences="$URL" \
  --impersonate-service-account="$SA" --include-email)

curl -i -H "Authorization: Bearer $ID_TOKEN" "$URL?symbol=AAPL&interval=DAILY&range=1y"
```

---

## Safety Checklist

- You included only partner HTTPS services in `-Services`.
- You did NOT include internal/browser endpoints (those must remain public-invokable).
- You verified partner application code performs token validation (Google OIDC/Firebase ID) and allowlist checks.

---

## Troubleshooting

- Script exits immediately: Provide `-Services` with at least one partner service name.
- 403 after lockdown: Ensure your request includes a valid Google OIDC ID token with `aud` = service URL and `email` claim for an allowlisted SA.
- Not seeing expected policy: IAM changes are immediate. Re-run `get-iam-policy` and ensure you’re querying the correct project/region/service.

---

## Related Docs

- `docs/partner-discovery.md` — Access models, security, and data shapes
- `docs/partner-integration.md` — How partners should call the time-series API (OIDC examples)
- `functions/src/v2/utils/cors-middleware.ts` — Internal Origin allowlist (`ALLOWED_ORIGINS`)

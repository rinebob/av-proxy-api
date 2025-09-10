# Documentation Index

Last updated: 2025-09-10

---

## Partner Documentation

Read in this order:

1. Partner Discovery
   - File: `docs/partner-discovery.md`
   - Purpose: Conceptual overview, surface area, data shapes, authentication model, and operational expectations for partners.

2. Partner Integration Guide
   - File: `docs/partner-integration.md`
   - Purpose: Step-by-step instructions for server-to-server access using Google OIDC (and alternatives), request examples, and troubleshooting.

---

## Internal (SavantApi.com) Documentation

For Savant internal admins only:

1. Internal Gateway Admin
   - File: `docs/internal-gateway-admin.md`
   - Purpose: How to operate browser-facing gateways (Origin allowlist + CORS), IAM guidance (keep `allUsers`), change management, and runbook.

2. Lockdown Invokers Script (Partner-only)
   - File: `functions/scripts/README.lockdown-invokers.md`
   - Purpose: Manage Cloud Run `roles/run.invoker` for partner HTTP endpoints (remove `allUsers`, grant invoker to specific SAs). Not for internal gateways.

---

## Notes

- Partner endpoints are server-to-server only and use dual-auth with allowlisted service accounts.
- Internal browser-facing endpoints are SavantApi.com-only and protected by an Origin allowlist in application code.

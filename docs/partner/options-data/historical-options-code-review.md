# Historical Options Endpoint Review

**Status:** Remediated
**Reviewed:** 2026-07-20

## Confirmed Findings

- The removed per-partner Firestore request guard was still described in the PRD and discovery documentation.
- Empty-string option metrics were accepted as numeric zeroes during normalization and analysis.
- Direct `400` and `405` endpoint responses did not include the documented timestamp field.
- `OPTIONS` succeeded despite the endpoint being documented as GET-only with browser CORS disabled.

## Remediation

- Removed all obsolete request-guard, quota-denial, and `Retry-After` claims from partner documentation.
- Treat empty or whitespace-only option numeric values as unavailable.
- Added timestamps to direct `400` and `405` responses.
- Removed the `OPTIONS` success path so non-GET requests return `405`.
- Added regression coverage for empty metric values and direct method errors.

## Fourth-Pass Findings and Remediation

- **Test alias:** Added a dedicated test TypeScript project so the configured `@shared` alias resolves in the editor and test compiler.
- **Provider error categories:** Replaced raw category literals with an enum.
- **HTTP method:** Replaced the endpoint's raw method literal with the shared HTTP method enum.
- **Test harness:** Reworked the partner endpoint test runner to await registered asynchronous cases before setting the process exit code.
- **Endpoint coverage:** Added controlled dependency injection only at the exported handler boundary to test authentication, invalid request, typed provider failure, successful no-persistence response, and response-size rejection paths.

## Fifth-Pass Contract Remediation

- Replaced the invented `alpha_vantage` response value with `ApiProvider.ALPHA_VANTAGE` and updated both partner response examples to `alpha-vantage`.
- Added `HistoricalOptionsErrorCode`; the handler, provider-error mapper, and focused tests use it instead of raw public error-code literals.
- Replaced raw provider-error map keys with `AlphaVantageUpstreamErrorCategory` enum members.
- Replaced all historical-options `datatype` literals with the shared Alpha Vantage JSON response-format constant.
- Corrected the stale PRD statement that said no partner endpoint existed.

## Sixth-Pass Holistic Remediation

- Added endpoint-local fail-closed behavior when `EXPECTED_GOOGLE_AUDIENCE` is empty, without altering global dual-auth behavior for other partner endpoints.
- Added bounded structured lifecycle logs for request ID, status, upstream duration, response bytes, contract count, and processing duration; deployment-managed log-based metrics remain a deployment task.
- Documented the exact shared authentication middleware envelope and removed incorrect endpoint code claims for authentication failures.
- Corrected the RS field contract: `type` and all other normalized contract fields are optional.
- Documented that unknown query parameters are ignored.

## Seventh-Pass Consolidated Remediation

- Defined `analysis.summary.totalContracts` as the full count of returned normalized contracts. Total volume and open interest now include all contracts with usable metrics, while directional and grouped breakdowns use only the fields required for those calculations.
- Added regression coverage for incomplete returned contracts so aggregate summary totals cannot silently shrink.
- Distinguished shared authentication middleware responses from the endpoint-generated `FORBIDDEN` response for a Firebase identity, and aligned the PRD, discovery document, RS guide, and endpoint test.

## Remaining Deployment Prerequisites

- Configure `ALPHAVANTAGE_API_KEY`, `ALLOWED_SERVICE_ACCOUNT_EMAILS`, and `EXPECTED_GOOGLE_AUDIENCE`.
- Restrict Cloud Run invoker IAM to the approved RS service account.
- Design any future Alpha Vantage throttle as a shared provider-level capability, not endpoint-specific request accounting.

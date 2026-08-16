/**
 * @topic #5 — Alpha Vantage Endpoint Expansion (opened 2026-08-15)
 */
# Partner Endpoint Inventory

Single source of truth for all deployed partner HTTPS Cloud Function endpoints. Other docs should link here instead of maintaining their own lists.

Last updated: 2026-08-15

---

## Data-Serving Endpoints

These endpoints serve data to partner applications (read-only from Firestore or computed on-demand).

| Function Name | Cloud Run Service | Method | Symbol Restriction | Auth | Purpose | Detailed Docs |
|---|---|---|---|---|---|---|
| `partnerTimeSeriesV2` | `partnertimeseriesv2` | GET | None (any tracked symbol) | Dual-auth (OIDC/Firebase) | Normalized OHLCV time series (daily/weekly/monthly) from Firestore | `docs/partner/partner-discovery.md`, `docs/partner/partner-integration.md` |
| `partnerIntradaySnapshotV2` | `partnerintradaysnapshotv2` | POST | None (any tracked symbol, max 1000 per request) | Dual-auth (OIDC/Firebase) | Bulk intraday price snapshots from Firestore | `docs/partner/partner-discovery.md` § Partner Intraday Snapshot API |
| `partnerCompanyOverviewV2` | `partnercompanyoverviewv2` | GET | None (equity symbols only; ETFs/indexes return 404) | Dual-auth (OIDC/Firebase) | AV OVERVIEW fundamentals data from Firestore | `docs/partner/partner-company-overview.md` |
| `partnerListTrackedSymbolsV2` | `partnerlisttrackedsymbolsv2` | GET | N/A | Dual-auth (OIDC/Firebase) | List all tracked symbols in the backend | `docs/partner/partner-discovery.md` |
| `partnerMarketHolidays` | `partnermarketholidays` | GET | N/A | Dual-auth (OIDC/Firebase) | US market holiday calendar | (none yet) |
| `partnerHistoricalOptionsV2` | `partnerhistoricaloptionsv2` | GET | None (any symbol with options data) | Dual-auth (OIDC/Firebase) | Full historical options chain for a symbol/date (live AV fetch) | `docs/partner/options-data/historical-options-discovery.md` |
| `partnerHistoricalOptionsContractV2` | `partnerhistoricaloptionscontractv2` | GET | **QQQ, TQQQ only** | Dual-auth (OIDC/Firebase) | Pre-materialized per-contract options time series from GCS | `docs/partner/options-data/historical-options-contract-v2-discovery.md` |
| `partnerListContractsV2` | `partnerlistcontractsv2` | GET | **QQQ, TQQQ only** | Dual-auth (OIDC/Firebase) | Discover available option contract IDs by expiration/strike/type | `docs/partner/options-data/historical-options-contract-v2-discovery.md` |
| `partnerContractCatalogV2` | `partnercontractcatalogv2` | GET | **QQQ, TQQQ only** | Dual-auth (OIDC/Firebase) | Query contract catalog with filtering (expiration range, strike buckets, type, moneyness) | `docs/partner/options-data/partner-contract-catalog-v2-as-built.md` |
| `partnerSpreadTimeSeries` | `partnerspreadtimeseries` | POST | **QQQ, TQQQ only** | Dual-auth (OIDC/Firebase) | Historical time series for a single options spread | `docs/partner/options-data/spread-time-series-discovery.md` |
| `partnerSpreadTimeSeriesBatch` | `partnerspreadtimeseriesbatch` | POST | **QQQ, TQQQ only** | Dual-auth (OIDC/Firebase) | Batch spread time series (up to 200 spreads per request) | `docs/partner/options-data/spread-time-series-discovery.md` |
| `partnerTechnicalIndicatorsV2` | `partnertechnicalindicatorsv2` | GET | None (any tracked symbol) | Dual-auth (OIDC/Firebase) | On-demand AV technical indicators (Hilbert Transform family) — config-driven, calls AV directly | `docs/PRD-av-endpoints-hilbert.md` |

## Internal / Operational Endpoints

These endpoints are for internal operations and testing, not partner data consumption.

| Function Name | Cloud Run Service | Method | Auth | Purpose |
|---|---|---|---|---|
| `partnerDataReadyPublishV2` | `partnerdatareadypublishv2` | POST | Dual-auth (OIDC/Firebase) | Manually publish a Data-Ready Pub/Sub message for testing |
| `partnerDataReadyHeartbeat` | `partnerdatareadyheartbeat` | Scheduled | N/A (Cloud Scheduler) | Scheduled heartbeat publisher for Data-Ready notifications |
| `onDailyAdjustedFinalizedPublish` | `ondailyadjustedfinalizedpublish` | Firestore Trigger | N/A | Publishes Data-Ready when daily adjusted bars are finalized |

## Notes

- **Dual-auth**: Accepts either Google OIDC ID token (preferred for partners) or Firebase ID token (internal). See `docs/partner/partner-auth-and-audience.md`.
- **Symbol restriction**: Enforced in application code via `ALLOWED_SYMBOLS` set from `@shared/core` (currently `QQQ` and `TQQQ`).
- **Cloud Run service names** are all lowercase (see deploy workflow gotcha #1 in `.devin/workflows/deploy-partner-endpoint.md`).
- **All partner endpoints** require `EXPECTED_GOOGLE_AUDIENCE` and `ALLOWED_SERVICE_ACCOUNT_EMAILS` secrets to be mounted.
- For post-deployment steps, see `.devin/workflows/deploy-partner-endpoint.md`.

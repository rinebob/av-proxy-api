# Verification Guide: Task #38 — SavantApiEndpoint enum + TypeScript response types

## Scripts

### `earnings-38-sa-endpoint-types.ts`

Verifies that the `shared/alpha-vantage` package correctly exports the `SavantApiEndpoint` enum, `SA_ENDPOINT_TO_AV_FUNCTION` mapping, and all TypeScript response types for the three earnings endpoints.

**Command:**
```bash
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/earnings-38-sa-endpoint-types.ts
```

**What it checks:**
- All four `SavantApiEndpoint` enum values exist and have correct string values
- Exactly 4 enum values (no extras)
- Each SA endpoint maps to the correct AV function via `SA_ENDPOINT_TO_AV_FUNCTION`
- `SA_EARNINGS_CALENDAR` and `SA_EARNINGS_CALENDAR_GLOBAL` both map to `EARNINGS_CALENDAR` (same AV function, different SA endpoints)
- `AvEarningsResponse` type accepts correct shape with `annualEarnings` and `quarterlyEarnings` (including `reportTime`)
- `AvEarningsEstimatesResponse` type accepts nullable fields as `null`
- `AvEarningsCalendarEntry` type accepts empty strings for `estimate` and `timeOfTheDay`

**Passing result:**
```
=== All verification checks passed ===
```

**Failing result:**
```
FAIL: <description of what failed>
```
(exit code 1)

**Setup notes:**
- Run `npm run copy-shared` first if the shared package hasn't been built since changes were made.
- This script does not hit any external API or Firestore — it's pure import + shape verification.

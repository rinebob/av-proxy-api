# Verification Guide: Task #39 — Config changes for earnings endpoints

## Scripts

### `earnings-39-config-changes.ts`

Verifies that the AV_ENDPOINT_CONFIGS and AV_IMPLEMENTED_ENDPOINTS are correct at runtime for the three earnings endpoints.

**Command:**
```bash
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/earnings-39-config-changes.ts
```

**What it checks:**
- EARNINGS config: TTL is 7 days (not 30), symbolUsage is REQUIRED, firestorePath is grouped under earnings/
- EARNINGS_ESTIMATES config: TTL is 7 days, symbolUsage is REQUIRED, firestorePath is grouped under earnings/ (not standalone earnings-estimates/)
- EARNINGS_CALENDAR config: symbolUsage is NOT_SUPPORTED (global), firestorePath is market-data/ with no {symbol}, TTL is 1 day, horizon parameter default is 12month
- AV_IMPLEMENTED_ENDPOINTS includes all three earnings endpoints

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
- This script does not hit any external API or Firestore — it's pure config + set membership verification.

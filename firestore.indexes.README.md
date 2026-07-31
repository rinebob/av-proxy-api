# Firestore Indexes

## Why this file only contains 8 indexes

The `alpha-vantage-proxy-api` project has **42 composite indexes already deployed** in Firestore (auto-created from failed queries + previously deployed). The Firebase CLI cannot match indexes in `firestore.indexes.json` to existing deployed indexes — it tries to create them again, gets a 409 Conflict, and aborts the entire deploy.

To work around this, only the **8 new indexes** (not yet deployed) are listed in `firestore.indexes.json`. During `firebase deploy --only firestore:indexes`, answer **N** to the "Would you like to delete these indexes?" prompt to preserve all existing indexes.

## 21 Indexes Removed from firestore.indexes.json (already deployed — do NOT delete)

These indexes were previously listed in `firestore.indexes.json` but already exist in Firestore. They were removed to avoid 409 conflicts on deploy. All are on `ts-contracts` collection.

### ts-contracts — latestDelta (numeric)
1. `(expiration ASC, latestDelta ASC, __name__ ASC)`
2. `(expiration ASC, latestDelta DESC, __name__ DESC)`

### ts-contracts — contractLengthBucket without type
3. `(contractLengthBucket ASC, strike ASC, __name__ ASC)`
4. `(contractLengthBucket ASC, strike DESC, __name__ DESC)`
5. `(contractLengthBucket ASC, latestDelta ASC, __name__ ASC)`
6. `(contractLengthBucket ASC, latestDelta DESC, __name__ DESC)`
7. `(contractLengthBucket ASC, observationCount ASC, __name__ ASC)`
8. `(contractLengthBucket ASC, observationCount DESC, __name__ DESC)`

### ts-contracts — type + expiration (equality)
9. `(type ASC, expiration ASC, __name__ ASC)`
10. `(type ASC, expiration DESC, __name__ DESC)`

### ts-contracts — type + expiration + strike
11. `(type ASC, expiration ASC, strike ASC, __name__ ASC)`
12. `(type ASC, expiration ASC, strike DESC, __name__ DESC)`

### ts-contracts — type + expiration + contractLengthDays
13. `(type ASC, expiration ASC, contractLengthDays ASC, __name__ ASC)`
14. `(type ASC, expiration ASC, contractLengthDays DESC, __name__ DESC)`

### ts-contracts — type + expiration + observationCount
15. `(type ASC, expiration ASC, observationCount ASC, __name__ ASC)`
16. `(type ASC, expiration ASC, observationCount DESC, __name__ DESC)`

### ts-contracts — type + expiration + latestDelta
17. `(type ASC, expiration ASC, latestDelta ASC, __name__ ASC)`
18. `(type ASC, expiration ASC, latestDelta DESC, __name__ DESC)`

### ts-contracts — type + contractLengthBucket + expiration
19. `(type ASC, contractLengthBucket ASC, expiration ASC, __name__ ASC)`
20. `(type ASC, contractLengthBucket ASC, expiration DESC, __name__ DESC)`

### ts-contracts — expiration + strike (auto-created)
21. `(expiration ASC, strike ASC, __name__ ASC)` — CICAgNiav4AK

## Other Deployed Indexes (NOT in firestore.indexes.json — do NOT delete)

### realtime-runs
- `(interval ASC, runType ASC, marketDate DESC, __name__ DESC)`

### request-logs
- `(endpointId ASC, timestamp DESC, __name__ DESC)`
- `(status ASC, timestamp DESC, __name__ DESC)`

### tracked-symbols
- `(_isActive ASC, symbol ASC, __name__ ASC)`
- `(isActive ASC, symbol ASC, __name__ ASC)`

### ts-contracts — additional auto-created indexes
- `(expiration ASC, strike ASC, __name__ ASC)`
- `(expiration ASC, latest.delta ASC, __name__ ASC)`
- `(expiration ASC, type ASC, strike ASC, __name__ ASC)`
- `(contractLengthBucket ASC, type ASC, strike DESC, __name__ DESC)`
- `(expiration DESC, strike DESC, __name__ DESC)`
- `(expiration DESC, type ASC, strike DESC, __name__ DESC)`
- `(contractLengthBucket ASC, expiration ASC, __name__ ASC)`
- `(expiration ASC, latest.delta DESC, __name__ DESC)`
- `(expiration ASC, contractLengthBucket ASC, strike DESC, __name__ DESC)`
- `(contractLengthBucket ASC, contractLengthDays DESC, __name__ DESC)`
- `(expiration ASC, type ASC, strike DESC, __name__ DESC)`
- `(contractLengthBucket ASC, expiration DESC, __name__ DESC)`
- `(expiration ASC, contractLengthBucket ASC, strike ASC, __name__ ASC)`
- `(contractLengthBucket ASC, type ASC, strike ASC, __name__ ASC)`
- `(strike DESC, expiration DESC, __name__ DESC)`
- `(strike ASC, expiration ASC, __name__ ASC)`
- `(contractLengthBucket ASC, contractLengthDays ASC, __name__ ASC)`

## 8 New Indexes (in firestore.indexes.json — will be created on deploy)

### ts-contracts — contractLengthBucket (equality/in) + expiration range + sort
1. `(contractLengthBucket ASC, expiration ASC, strike ASC, __name__ ASC)`
2. `(contractLengthBucket ASC, expiration ASC, strike DESC, __name__ DESC)`
3. `(contractLengthBucket ASC, expiration ASC, contractLengthDays ASC, __name__ ASC)`
4. `(contractLengthBucket ASC, expiration ASC, contractLengthDays DESC, __name__ DESC)`
5. `(contractLengthBucket ASC, expiration ASC, observationCount ASC, __name__ ASC)`
6. `(contractLengthBucket ASC, expiration ASC, observationCount DESC, __name__ DESC)`
7. `(contractLengthBucket ASC, expiration ASC, latestDelta ASC, __name__ ASC)`
8. `(contractLengthBucket ASC, expiration ASC, latestDelta DESC, __name__ DESC)`

### 5 Indexes also removed (already deployed — were in previous version of this file)

These 5 indexes were previously listed as "new" but are already deployed in Firestore:

- `(expiration ASC, strike DESC, __name__ DESC)`
- `(expiration ASC, contractLengthDays ASC, __name__ ASC)`
- `(expiration ASC, contractLengthDays DESC, __name__ DESC)`
- `(expiration ASC, observationCount ASC, __name__ ASC)`
- `(expiration ASC, observationCount DESC, __name__ DESC)`

## Deploy Instructions

```bash
firebase deploy --only firestore:indexes --project alpha-vantage-proxy-api
```

When prompted "Would you like to delete these indexes?", answer **N** to preserve all existing indexes.

Indexes on 370K+ docs take several minutes to build. Queries requiring the new indexes will return 500 until state is `READY`.

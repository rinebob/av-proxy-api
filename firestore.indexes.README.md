# Firestore Indexes

## Why this file only contains 8 indexes

The `alpha-vantage-proxy-api` project has **22 composite indexes already deployed** in Firestore. The Firebase CLI has a known bug where it cannot match indexes in `firestore.indexes.json` to existing deployed indexes — it tries to create them again, gets a 409 Conflict, and aborts the entire deploy.

To work around this, only the **8 new indexes** (not yet deployed) are listed in `firestore.indexes.json`. During `firebase deploy --only firestore:indexes`, answer **N** to the "Would you like to delete these indexes?" prompt to preserve the 22 existing indexes.

## 22 Deployed Indexes (NOT in firestore.indexes.json — do NOT delete)

### realtime-runs
1. `(interval ASC, runType ASC, marketDate DESC, __name__ DESC)` — CICAgNi47oMK

### request-logs
2. `(endpointId ASC, timestamp DESC, __name__ DESC)` — CICAgJj7z4EK
3. `(status ASC, timestamp DESC, __name__ DESC)` — CICAgJjF9oIK

### tracked-symbols
4. `(_isActive ASC, symbol ASC, __name__ ASC)` — CICAgJim14AK
5. `(isActive ASC, symbol ASC, __name__ ASC)` — CICAgJiUpoMK

### ts-contracts
6. `(expiration ASC, strike ASC, __name__ ASC)` — CICAgNiav4AK
7. `(expiration ASC, latest.delta ASC, __name__ ASC)` — CICAgLjy8IAK
8. `(expiration ASC, type ASC, strike ASC, __name__ ASC)` — CICAgNiroIEK
9. `(contractLengthBucket ASC, type ASC, strike DESC, __name__ DESC)` — CICAgLiT6IEK
10. `(expiration DESC, strike DESC, __name__ DESC)` — CICAgNjpgYIK
11. `(expiration DESC, type ASC, strike DESC, __name__ DESC)` — CICAgLjRyYIK
12. `(contractLengthBucket ASC, expiration ASC, __name__ ASC)` — CICAgLiIkYMK
13. `(expiration ASC, latest.delta DESC, __name__ DESC)` — CICAgJjmnIgK
14. `(expiration ASC, contractLengthBucket ASC, strike DESC, __name__ DESC)` — CICAgNja0ogK
15. `(contractLengthBucket ASC, contractLengthDays DESC, __name__ DESC)` — CICAgNjp84oK
16. `(expiration ASC, type ASC, strike DESC, __name__ DESC)` — CICAgNi4o4sK
17. `(contractLengthBucket ASC, expiration DESC, __name__ DESC)` — CICAgJiH2JAK
18. `(expiration ASC, contractLengthBucket ASC, strike ASC, __name__ ASC)` — CICAgJjmiJEK
19. `(contractLengthBucket ASC, type ASC, strike ASC, __name__ ASC)` — CICAgLiIjZIK
20. `(strike DESC, expiration DESC, __name__ DESC)` — CICAgNjaxJEK
21. `(strike ASC, expiration ASC, __name__ ASC)` — CICAgNi4-ZIK
22. `(contractLengthBucket ASC, contractLengthDays ASC, __name__ ASC)` — CICAgNjp5ZMK

## 8 New Indexes (in firestore.indexes.json — will be created on deploy)

These are the indexes that don't exist in Firestore yet:

### ts-contracts — latestDelta (numeric, replaces stale `latest.delta` string indexes)
1. `(expiration ASC, latestDelta ASC, __name__ ASC)`
2. `(expiration ASC, latestDelta DESC, __name__ DESC)`

### ts-contracts — contractLengthBucket without type (fixes "Both" + length bucket 500 bug)
3. `(contractLengthBucket ASC, strike ASC, __name__ ASC)`
4. `(contractLengthBucket ASC, strike DESC, __name__ DESC)`
5. `(contractLengthBucket ASC, latestDelta ASC, __name__ ASC)`
6. `(contractLengthBucket ASC, latestDelta DESC, __name__ DESC)`
7. `(contractLengthBucket ASC, observationCount ASC, __name__ ASC)`
8. `(contractLengthBucket ASC, observationCount DESC, __name__ DESC)`

## Deploy Instructions

```bash
firebase deploy --only firestore:indexes --project alpha-vantage-proxy-api
```

When prompted "Would you like to delete these indexes?", answer **N** to preserve the 22 existing indexes.

Indexes on 370K+ docs take several minutes to build. Queries requiring the new indexes will return 500 until state is `READY`.

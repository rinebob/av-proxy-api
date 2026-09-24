# Verification Guide: Task #119 — firestore.indexes.json ↔ prod reconciliation

## Scripts

### ops-119-firestore-indexes.ts

**Purpose:** Confirms `firestore.indexes.json` is a complete, current mirror of the composite indexes deployed in prod. The file is the source of truth — drift in either direction fails the script.

**Pipeline stages verified:**
- Deploy config: every file entry exists in prod (nothing pending/stale)
- Drift detection: every prod index is tracked in the file (nothing console-created or orphaned)
- `fieldOverrides` (e.g. `news.ttl` TTL policy) match between file and prod

**Prerequisite:** firebase CLI authenticated (`firebase login`) with access to `alpha-vantage-proxy-api`.

**Command:**
```bash
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/ops-119-firestore-indexes.ts
```

**Arguments:** none.

**What it checks (6 checks):**
1. `firebase firestore:indexes` runs successfully against prod
2. `firestore.indexes.json` parses and has an `indexes` array
3. Prod index list parses and has an `indexes` array
4. Zero file entries missing from prod (would 409 or indicate a stale entry)
5. Zero prod indexes untracked in the file (drift — the #119 failure mode)
6. `fieldOverrides` are identical

**Passing result:** All checks print `PASS:`, ends with `=== All verification checks passed ===`, exits 0.

**Failing result:** `FAIL:` + exit 1. Failing items are listed under `INFO:` lines — either deploy the file (`firebase deploy --only firestore:indexes`) to create pending entries, or add prod-only indexes to the file / delete them from prod.

**Setup/teardown:** None. Read-only — no writes to prod. Safe to include in run-all.

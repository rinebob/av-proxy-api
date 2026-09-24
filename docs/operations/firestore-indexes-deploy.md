# Firestore Indexes: What Happened, and How to Manage Them Now

*Topic #118 / Task #119 — reconciled 2026-09-23.*

## The problem

`firebase deploy --only firestore:indexes` was failing partway through with a
`409 Conflict`: the CLI tried to create a `ts-contracts` composite index that
already existed in prod, and aborted. Indexes listed *before* the collision
deployed; everything after it never ran.

## Root cause

Two things combined:

1. **The file only tracked new indexes.** `firestore.indexes.json` had been
   deliberately trimmed to contain only not-yet-deployed indexes, with deploys
   answering **N** to the "delete these indexes?" prompt to preserve the rest.
   Meanwhile prod accumulated 47 untracked indexes created outside the file — via the
   Firebase console and the "create index" links in query-error messages — so
   the file and prod drifted permanently apart.

2. **Format mismatch.** File entries were written with an explicit `__name__`
   field (e.g. `{ "fieldPath": "__name__", "order": "ASCENDING" }`). Indexes
   created via console/error-link paths don't carry that in their spec, so the
   CLI didn't recognize the file entry and the prod index as identical — it
   attempted a create and hit 409.

## The fix

- `firestore.indexes.json` was regenerated from `firebase firestore:indexes`
  output — all 78 prod indexes, verbatim CLI-export format (no `__name__`).
- A redeploy confirmed a clean no-op: no 409, nothing offered for deletion.
- A drift-detection script was added:
  `functions/scripts/verify/ops-119-firestore-indexes.ts` — diffs the file
  against prod in both directions and fails on any drift.

## Rules going forward

**The file is the complete source of truth.** It must mirror prod exactly.

**Use CLI-export format.** New entries must not include an explicit `__name__`
field — that's the mismatch that caused the 409s. Copy the shape of any existing
entry in the file, or create the index first and re-export (see below).

**Indexes created outside the file are drift.** Console-created or
error-link-created indexes work fine in prod but silently untrack themselves —
the verify script will flag them. Either add them to the file or delete them
from prod.

## How-to

### Add a new index

1. Add the entry to `firestore.indexes.json`:

   ```json
   {
     "collectionGroup": "my-collection",
     "queryScope": "COLLECTION",
     "fields": [
       { "fieldPath": "fieldA", "order": "ASCENDING" },
       { "fieldPath": "fieldB", "order": "DESCENDING" }
     ]
   }
   ```

   No `__name__` — Firestore appends it implicitly.

2. Deploy:

   ```bash
   firebase deploy --only firestore:indexes --project alpha-vantage-proxy-api
   ```

   Expected: the new index is created, everything else no-ops, no delete prompt.

3. Confirm:

   ```bash
   cd functions
   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/ops-119-firestore-indexes.ts
   ```

Note: a new composite index on a large collection (e.g. `ts-contracts`, 370K+
docs) takes several minutes to build. Queries needing it fail until its state
is `READY` in the Firebase console.

### Alternative: create in console, then adopt

If you create an index via the console or a query-error link:

1. Run `firebase firestore:indexes --project alpha-vantage-proxy-api`
2. Copy the new index's JSON block into `firestore.indexes.json`
3. Run the verify script — drift should be zero

### Delete an index

1. Remove the entry from `firestore.indexes.json`
2. Deploy — the CLI prompts "Would you like to delete these indexes?" listing
   exactly what it will remove. Confirm only if the list matches your intent;
   answer **N** to abort.

### Diagnose a 409 on deploy

Deploy fails with `409 ... index already exists`:

1. Run the verify script to see the drift report.
2. If the colliding index is in the file with an explicit `__name__` field —
   remove `__name__` and redeploy.
3. If the file entry is genuinely new but prod has a same-fields index that the
   CLI won't match — delete the prod copy in the console, then redeploy.

## References

- `firestore.indexes.json` — the index file (repo root)
- `firestore.indexes.README.md` — quick reference at the file's side
- `functions/scripts/verify/ops-119-firestore-indexes.md` — verify script guide
- Issue [#119](https://github.com/rinebob/av-proxy-api/issues/119) — the bug report with verified prod state

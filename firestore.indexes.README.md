# Firestore Indexes

`firestore.indexes.json` is the **complete source of truth** for composite indexes in the
`alpha-vantage-proxy-api` project. It is a verbatim copy of `firebase firestore:indexes`
output — every index deployed in prod is tracked here, and every entry here exists in prod.

Full background and how-to: [docs/operations/firestore-indexes-deploy.md](docs/operations/firestore-indexes-deploy.md)

## Adding a new index

1. Add the entry to `firestore.indexes.json` in **CLI-export format** — the same shape
   `firebase firestore:indexes` emits: `collectionGroup`, `queryScope`, and `fields`
   with `fieldPath`/`order`. **Do not add an explicit `__name__` field** — entries with
   `__name__` do not match the deployed index spec and the deploy will fail with a
   409 Conflict.
2. Deploy:

   ```bash
   firebase deploy --only firestore:indexes --project alpha-vantage-proxy-api
   ```

3. Verify drift is zero:

   ```bash
   cd functions
   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/ops-119-firestore-indexes.ts
   ```

Indexes on large collections (370K+ docs) take several minutes to build. Queries
requiring a new index will fail until its state is `READY`.

## Deleting an index

Remove the entry from `firestore.indexes.json`, then deploy — the CLI will prompt
"Would you like to delete these indexes?" and list them. Confirm only the intended
deletions. **Never** answer Y to deleting indexes you did not intentionally remove.

## Drift policy

Indexes created outside this file (Firebase console, query-error links, partial
deploys) drift the file from prod. If that happens:

1. Run `firebase firestore:indexes --project alpha-vantage-proxy-api` and reconcile —
   either add the prod index to the file (intended) or delete it from prod (stray).
2. The verify script `ops-119-firestore-indexes.ts` reports drift in both directions.

## History

The file previously tracked only *new* indexes as a workaround for 409 conflicts
(deploy aborted when the CLI tried to create an index that already existed in prod).
Root cause of the 409s: file entries used explicit `__name__` fields, which don't match
indexes created via the console/error-link path. Reconciled on 2026-09-23 (task #119):
the file was regenerated from `firebase firestore:indexes` output and now mirrors all
78 deployed indexes; deploy is a clean no-op.

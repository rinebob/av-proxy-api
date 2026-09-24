/**
 * Verification script for Task #119 — firestore.indexes.json ↔ prod reconciliation.
 *
 * Fetches the live composite index list from prod via `firebase firestore:indexes`
 * and diffs it semantically against the repo's firestore.indexes.json. The file is
 * the source of truth: every entry must exist in prod and every prod index must be
 * tracked in the file. Drift in either direction fails the script.
 *
 * Format policy (see firestore.indexes.README.md): entries must use the CLI-export
 * format — no explicit `__name__` fields. Entries written with `__name__` do not
 * match prod indexes and cause `firebase deploy --only firestore:indexes` to 409.
 *
 * Prerequisite: firebase CLI authenticated (`firebase login`) for project
 * alpha-vantage-proxy-api. No writes — read-only.
 *
 * Usage: npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/ops-119-firestore-indexes.ts
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const INDEXES_FILE = path.resolve(__dirname, '../../../firestore.indexes.json');
const PROJECT = 'alpha-vantage-proxy-api';

interface IndexField {
  fieldPath: string;
  order?: string;
  arrayConfig?: string;
  queryScope?: string;
  ttl?: boolean;
}

interface CompositeIndex {
  collectionGroup: string;
  queryScope: string;
  fields: IndexField[];
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error('FAIL: ' + message);
    process.exit(1);
  }
  console.log('PASS: ' + message);
}

function indexKey(ix: CompositeIndex): string {
  const fields = ix.fields
    .map((f) => `${f.fieldPath}:${f.order ?? ''}:${f.arrayConfig ?? ''}`)
    .join(',');
  return `${ix.collectionGroup}|${ix.queryScope}|${fields}`;
}

function parseJson(raw: string, source: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    console.error(`FAIL: could not parse ${source} as JSON`);
    process.exit(1);
  }
}

function main(): void {
  console.log('--- Verifying firestore.indexes.json matches prod ---\n');

  // shell:true is required for firebase.cmd resolution on Windows
  const res = spawnSync('firebase', ['firestore:indexes', '--project', PROJECT], {
    shell: true,
    encoding: 'utf8',
  });
  if (res.error) {
    console.error(`FAIL: could not run firebase CLI — ${res.error.message}`);
    process.exit(1);
  }
  assert(res.status === 0 && !!res.stdout, `firebase firestore:indexes succeeded (exit ${res.status})`);

  const prod = parseJson(res.stdout, 'firebase firestore:indexes output');
  const local = parseJson(fs.readFileSync(INDEXES_FILE, 'utf8'), 'firestore.indexes.json');

  assert(Array.isArray(local.indexes), 'firestore.indexes.json parses with an indexes array');
  assert(Array.isArray(prod.indexes), 'prod index list parses with an indexes array');
  console.log(`INFO: file tracks ${local.indexes.length} indexes; prod has ${prod.indexes.length}`);

  // Entries written with an explicit __name__ field don't match the deployed
  // index spec and cause deploy-time 409s — the format rule is policy, so the
  // script enforces it directly rather than catching it indirectly as drift.
  const withName = (local.indexes as CompositeIndex[]).filter((ix) =>
    ix.fields.some((f) => f.fieldPath === '__name__'),
  );
  assert(withName.length === 0, `0 file entries use explicit __name__ field`);

  const prodKeys = new Set(prod.indexes.map(indexKey));
  const localKeys = new Set(local.indexes.map(indexKey));
  const localOnly = [...localKeys].filter((k) => !prodKeys.has(k));
  const prodOnly = [...prodKeys].filter((k) => !localKeys.has(k));

  if (localOnly.length > 0) {
    console.log('\nINFO: in file but not in prod (pending deploy or stale entry):');
    localOnly.forEach((k) => console.log('  ' + k));
  }
  if (prodOnly.length > 0) {
    console.log('\nINFO: in prod but not tracked in file (drift — add to file or delete from prod):');
    prodOnly.forEach((k) => console.log('  ' + k));
  }

  assert(localOnly.length === 0, `${localOnly.length} file entries missing from prod`);
  assert(prodOnly.length === 0, `${prodOnly.length} prod indexes untracked in file`);

  // Canonical stringify — key order in the CLI export is not a contract
  const canon = (v: any): any =>
    Array.isArray(v)
      ? v.map(canon)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
        : v;
  assert(
    JSON.stringify(canon(local.fieldOverrides ?? [])) === JSON.stringify(canon(prod.fieldOverrides ?? [])),
    'fieldOverrides match between file and prod',
  );

  console.log('\n=== All verification checks passed ===');
  process.exit(0);
}

main();

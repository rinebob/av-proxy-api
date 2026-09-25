/**
 * enable-options.ts — batch-enable `optionsEnabled` for tracked symbols
 * (Task #141, Thread #105).
 *
 * Thin CLI loop over the setOptionsEnabledV2 core (handleSetOptionsEnabled):
 * the optionable===true gate, audit-history append, and the false→true
 * swing-set enqueue all live there — this script adds symbol iteration,
 * --dry-run, and summary reporting. History entries record
 * changedBy: 'admin-script'.
 *
 * --dry-run runs the SAME core logic against a FirestoreLike wrapper whose
 * doc.set is a no-op and a stubbed enqueue — so the reported outcome is the
 * governed decision itself (including symbol validation and the optionable
 * gate), guaranteed not to drift from the live path.
 *
 * Usage (from functions/):
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json \
 *     scripts/admin/enable-options.ts --symbols A,MSFT --reason "pilot" [--dry-run]
 *
 *   or read symbols from a file (one per line or comma-separated):
 *   ... --symbols-file path/to/list.txt
 */
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'alpha-vantage-proxy-api' });
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { db } = require('../../src/firebase-admin-init');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { handleSetOptionsEnabled, SetOptionsEnabledErrorCode } = require('../../src/v2/symbol-flags/functions/set-options-enabled.core');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { enqueueSwingSetGeneration } = require('../../src/v2/swing-set/handlers/generate-swing-sets.core');
const fs = require('fs');

const ADMIN_UID = 'admin-script';

interface Args { dryRun: boolean; symbols?: string[]; symbolsFile?: string; reason?: string; }

function parseArgs(): Args {
  const args: Args = { dryRun: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--symbols') args.symbols = argv[++i]?.split(',').map((s: string) => s.trim().toUpperCase()).filter(Boolean);
    else if (a.startsWith('--symbols=')) args.symbols = a.slice('--symbols='.length).split(',').map((s: string) => s.trim().toUpperCase()).filter(Boolean);
    else if (a === '--symbols-file') args.symbolsFile = argv[++i];
    else if (a.startsWith('--symbols-file=')) args.symbolsFile = a.slice('--symbols-file='.length);
    else if (a === '--reason') args.reason = argv[++i];
    else if (a.startsWith('--reason=')) args.reason = a.slice('--reason='.length);
  }
  return args;
}

const log = (m: string) => console.log(`[enable-options] ${m}`);

function readSymbolsFile(path: string): string[] {
  return fs.readFileSync(path, 'utf8')
    .split(/[\r\n,]+/)
    .map((s: string) => s.trim().toUpperCase())
    .filter(Boolean);
}

/** FirestoreLike with real reads and no-op writes — dry-run sees the true gate decision. */
function dryRunDb(real: any): any {
  return {
    collection: (path: string) => {
      const col = real.collection(path);
      return {
        doc: (id: string) => {
          const ref = col.doc(id);
          return {
            get: () => ref.get(),
            set: async () => undefined,
            delete: async () => { throw new Error('dry-run: delete not permitted'); },
          };
        },
        where: (...a: any[]) => col.where(...a),
        get: () => col.get(),
      };
    },
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  let ids = args.symbols ?? (args.symbolsFile ? readSymbolsFile(args.symbolsFile) : undefined);
  if (!ids?.length) {
    console.error('Usage: --symbols A,B or --symbols-file <path> [--reason "..."] [--dry-run]');
    process.exitCode = 2;
    return;
  }
  ids = [...new Set(ids)];
  log(`start — ${ids.length} symbols, dryRun=${args.dryRun} reason=${args.reason ?? '(none)'}`);

  const deps = args.dryRun
    ? { db: dryRunDb(db), enqueue: async (_s: string) => 'dry-run', logger: console }
    : { db, enqueue: (s: string) => enqueueSwingSetGeneration(db, s), logger: console };

  let enabled = 0, alreadyEnabled = 0, notOptionable = 0, notTracked = 0, errors = 0;

  for (const symbol of ids) {
    try {
      const r = await handleSetOptionsEnabled(
        { symbol, enabled: true, reason: args.reason, uid: ADMIN_UID },
        deps,
      );
      if (r.ok && r.transitioned) { log(`${symbol}: ${args.dryRun ? 'would enable' : 'enabled'}`); enabled++; }
      else if (r.ok) { log(`${symbol}: already enabled (no-op)`); alreadyEnabled++; }
      else if (r.errorCode === SetOptionsEnabledErrorCode.SYMBOL_NOT_FOUND) { log(`${symbol}: not tracked`); notTracked++; }
      else if (r.errorCode === SetOptionsEnabledErrorCode.OPTIONS_NOT_OPTIONABLE) { log(`${symbol}: ${r.error}`); notOptionable++; }
      else { console.error(`${symbol}: ERROR ${r.errorCode} — ${r.error}`); errors++; }
    } catch (e: any) {
      errors++;
      console.error(`${symbol}: ERROR`, e?.message || e);
    }
  }

  log(`\n=== Summary ===`);
  log(`Processed:         ${ids.length}`);
  log(`Enabled:           ${enabled}`);
  log(`Already enabled:   ${alreadyEnabled}`);
  log(`Not optionable:    ${notOptionable}`);
  log(`Not tracked:       ${notTracked}`);
  log(`Errors:            ${errors}`);
  if (args.dryRun) log('(dry-run — nothing written)');
  process.exitCode = errors > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error('[enable-options] fatal', e?.message || e);
  process.exitCode = 1;
});

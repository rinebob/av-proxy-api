/**
 * options-data-140-set-options-enabled.ts — verify the curation core
 * against prod (Task #140).
 *
 * Mutating: flips a real optionable symbol (default AAPL) to the opposite
 * flag state and back, leaving two optionsEnabledHistory entries
 * (reason='verify-140', changedBy='verify-script') — a visible audit of
 * the test run. The optionsEnabled flag returns to its prior value.
 * Enqueue is stubbed so no real swing-set task is created. NOT in run-all.
 *
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-140-set-options-enabled.ts [SYMBOL]
 */
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'alpha-vantage-proxy-api' });
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { db } = require('../../src/firebase-admin-init');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { handleSetOptionsEnabled } = require('../../src/v2/symbol-flags/functions/set-options-enabled.core');

const UID = 'verify-script';
const REASON = 'verify-140';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`PASS: ${message}`);
}

async function main(): Promise<void> {
  const symbol = (process.argv[2] ?? 'AAPL').trim().toUpperCase();
  console.log(`--- Verifying setOptionsEnabled core (${symbol}) ---\n`);

  const snap = await db.doc(`tracked-symbols/${symbol}`).get();
  assert(snap.exists, `${symbol} tracked doc exists`);
  const before = snap.data();
  assert(before.optionable === true, `${symbol} is optionable (required for the gate)`);
  const priorHistoryLen = Array.isArray(before.optionsEnabledHistory) ? before.optionsEnabledHistory.length : 0;
  const priorEnabled = before.optionsEnabled === true;

  let enqueued: string[] = [];
  const deps = {
    db,
    enqueue: async (s: string) => { enqueued.push(s); return true; },
    logger: console,
  };

  // Gate: untracked symbol → SYMBOL_NOT_FOUND
  const notFound = await handleSetOptionsEnabled({ symbol: 'ZZUNTRACKED', enabled: true, uid: UID }, deps);
  assert(notFound.ok === false && notFound.errorCode === 'SYMBOL_NOT_FOUND', `untracked → ${notFound.errorCode}`);

  // Toggle to the opposite state first — a real transition regardless of
  // the starting value (otherwise a prior-enabled doc makes every call a
  // no-op and nothing is verified).
  const flip = await handleSetOptionsEnabled({ symbol, enabled: !priorEnabled, reason: REASON, uid: UID }, deps);
  assert(flip.ok === true && flip.transitioned === true, `flip to ${!priorEnabled} → ok=${flip.ok} transitioned=${flip.transitioned}`);
  // false→true enqueues; true→false does not
  assert(enqueued.length === (priorEnabled ? 0 : 1), `enqueue called ${enqueued.length}x after flip`);

  // Idempotent re-apply — no new history, no extra enqueue
  const noop = await handleSetOptionsEnabled({ symbol, enabled: !priorEnabled, uid: UID }, deps);
  assert(noop.ok === true && noop.transitioned === false, `re-apply no-op → transitioned=${noop.transitioned}`);
  assert(enqueued.length === (priorEnabled ? 0 : 1), 'no extra enqueue on no-op');

  // Restore prior state — another real transition (enqueues iff restoring to true)
  const restore = await handleSetOptionsEnabled({ symbol, enabled: priorEnabled, reason: REASON, uid: UID }, deps);
  assert(restore.ok === true && restore.transitioned === true, `restore to ${priorEnabled} → ok=${restore.ok} transitioned=${restore.transitioned}`);
  assert(enqueued.length === 1, `enqueue total ${enqueued.length}x (expected 1 — exactly one false→true)`);

  const after = (await db.doc(`tracked-symbols/${symbol}`).get()).data();
  const hist = after.optionsEnabledHistory as any[];
  assert(after.optionsEnabled === priorEnabled, `optionsEnabled restored to ${priorEnabled}`);
  assert(Array.isArray(hist) && hist.length === priorHistoryLen + 2, `history grew by 2 (${priorHistoryLen}→${hist.length})`);
  const last = hist[hist.length - 1];
  assert(last.enabled === priorEnabled && last.changedBy === UID && last.reason === REASON, `last history entry: ${JSON.stringify(last)}`);

  console.log('\nAll checks passed. Two verify-140 audit entries were left in optionsEnabledHistory.');
  process.exitCode = 0;
}

main().catch((e) => {
  console.error('fatal', e?.message || e);
  process.exitCode = 1;
});

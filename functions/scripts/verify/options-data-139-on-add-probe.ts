/**
 * options-data-139-on-add-probe.ts — verify the on-add probe transition core
 * + ingestion defaults against prod (Task #139).
 *
 * Mutating but idempotent: the 'probed' leg runs a real probeAndPersist on
 * an already-probed symbol (default AAPL), rewriting equivalent values.
 * NOT in run-all. Requires ALPHAVANTAGE_API_KEY.
 *
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-139-on-add-probe.ts [SYMBOL]
 */
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'alpha-vantage-proxy-api' });
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { db } = require('../../src/firebase-admin-init');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { TRACKED_SYMBOL_V2_FIELDS: F, TrackedSymbolOnboardingStatus } = require('@shared/alpha-vantage');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createHistoricalOptionsRetrievalService } = require('../../src/v2/historical-options-corpus/services/historical-options-retrieval.service');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { OptionableProbeService } = require('../../src/v2/symbol-flags/services/optionable-probe.service');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { handleSymbolReadyTransition } = require('../../src/v2/symbol-flags/triggers/symbol-ready.core');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { withOptionsFlagDefaults } = require('../../src/v2/symbol-flags/utils/options-flag-defaults');

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`PASS: ${message}`);
}

async function main(): Promise<void> {
  const symbol = (process.argv[2] ?? 'AAPL').trim().toUpperCase();
  console.log(`--- Verifying on-add probe transition core (${symbol}) ---\n`);

  // Ingestion defaults — pure helper
  const defaulted = withOptionsFlagDefaults({ symbol: 'NEW' } as any, undefined);
  assert(defaulted.optionsEnabled === false && Array.isArray(defaulted.optionsEnabledHistory),
    'withOptionsFlagDefaults adds optionsEnabled=false + empty history for new doc');
  const preserved = withOptionsFlagDefaults({ symbol: 'NEW' } as any, { optionsEnabled: true });
  assert(preserved.optionsEnabled === undefined, 'withOptionsFlagDefaults leaves existing optionsEnabled alone');

  const service = new OptionableProbeService({
    retrieval: createHistoricalOptionsRetrievalService(),
    db,
    logger: console,
  });
  const deps = { probeAndPersist: (s: string) => service.probeAndPersist(s), logger: console };

  const docSnap = await db.doc(`tracked-symbols/${symbol}`).get();
  assert(docSnap.exists, `${symbol} tracked doc exists`);
  const doc = docSnap.data();

  // Gate 1: no →READY transition → skip
  const notReady = { [F.ONBOARDING_STATUS]: TrackedSymbolOnboardingStatus.READY };
  const out1 = await handleSymbolReadyTransition(symbol, notReady, notReady, deps);
  assert(out1 === 'skipped-no-transition', `no transition → ${out1}`);

  // Gate 2: →READY transition but optionable already set → skip, no probe
  const out2 = await handleSymbolReadyTransition(
    symbol,
    { [F.ONBOARDING_STATUS]: TrackedSymbolOnboardingStatus.PRICE_DATA_READY },
    { ...doc, [F.ONBOARDING_STATUS]: TrackedSymbolOnboardingStatus.READY },
    deps,
  );
  assert(out2 === 'skipped-already-probed', `already-probed → ${out2}`);

  // Gate 3: →READY transition with optionable stripped → real probe runs.
  // MUTATING: rewrites the same flag values on the already-probed doc.
  const afterUnprobed = { ...doc, [F.ONBOARDING_STATUS]: TrackedSymbolOnboardingStatus.READY };
  delete afterUnprobed[F.OPTIONABLE];
  const out3 = await handleSymbolReadyTransition(
    symbol,
    { [F.ONBOARDING_STATUS]: TrackedSymbolOnboardingStatus.PRICE_DATA_READY },
    afterUnprobed,
    deps,
  );
  assert(out3 === 'probed', `unprobed →READY → ${out3}`);

  const after = (await db.doc(`tracked-symbols/${symbol}`).get()).data();
  assert(after[F.OPTIONABLE] === true, `doc.optionable restored to true`);
  assert(after[F.OPTIONABLE_PROBE_SUMMARY]?.totalContracts > 0, 'doc.optionableProbeSummary present');

  console.log('\nAll checks passed.');
  process.exitCode = 0;
}

main().catch((e) => {
  console.error('fatal', e?.message || e);
  process.exitCode = 1;
});

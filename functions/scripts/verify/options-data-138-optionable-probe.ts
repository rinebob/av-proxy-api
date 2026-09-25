/**
 * options-data-138-optionable-probe.ts — verify OptionableProbeService
 * end-to-end against prod (Task #138).
 *
 * Mutating: runs probeAndPersist on a real already-probed symbol (default
 * AAPL), rewriting its flag fields with equivalent values — no teardown
 * needed. NOT in run-all. Requires ALPHAVANTAGE_API_KEY.
 *
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-138-optionable-probe.ts [SYMBOL]
 */
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'alpha-vantage-proxy-api' });
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { db } = require('../../src/firebase-admin-init');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createHistoricalOptionsRetrievalService } = require('../../src/v2/historical-options-corpus/services/historical-options-retrieval.service');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { OptionableProbeService, isQuotaError } = require('../../src/v2/symbol-flags/services/optionable-probe.service');

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`PASS: ${message}`);
}

async function main(): Promise<void> {
  const symbol = (process.argv[2] ?? 'AAPL').trim().toUpperCase();
  console.log(`--- Verifying OptionableProbeService against prod (${symbol}) ---\n`);

  const service = new OptionableProbeService({
    retrieval: createHistoricalOptionsRetrievalService(),
    db,
    logger: console,
  });

  // Pure probe — no write
  const probed = await service.probe(symbol);
  assert(typeof probed.optionable === 'boolean', `probe() returned optionable=${probed.optionable}`);
  if (probed.optionable) {
    assert(
      typeof probed.summary?.totalContracts === 'number' && probed.summary.totalContracts > 0,
      `summary.totalContracts=${probed.summary?.totalContracts}`,
    );
    assert(typeof probed.summary?.expirations === 'number', `summary.expirations=${probed.summary?.expirations}`);
  }

  // Persist — rewrites equivalent fields on the already-probed doc
  const result = await service.probeAndPersist(symbol);
  const doc = (await db.doc(`tracked-symbols/${symbol}`).get()).data();
  assert(doc.optionable === result.optionable, `doc.optionable=${doc.optionable} matches probe result`);
  assert(doc.optionableCheckedAt !== undefined, 'doc.optionableCheckedAt present');
  if (result.optionable) {
    assert(typeof doc.optionableProbeSummary?.totalContracts === 'number', 'doc.optionableProbeSummary.totalContracts present');
    assert(doc.optionableProbeError === undefined, 'doc.optionableProbeError cleared on success');
  } else {
    assert(typeof doc.optionableProbeError === 'string', 'doc.optionableProbeError recorded on failure');
  }
  assert(doc.optionsEnabled === false || doc.optionsEnabled === true, `doc.optionsEnabled=${doc.optionsEnabled}`);
  assert(Array.isArray(doc.optionsEnabledHistory), 'doc.optionsEnabledHistory is an array');

  assert(typeof isQuotaError === 'function', 'isQuotaError exported for callers abort decisions');
  console.log('\nAll checks passed.');
  process.exitCode = 0;
}

main().catch((e) => {
  console.error('fatal', e?.message || e);
  process.exitCode = 1;
});

/**
 * Task #205 verification: ops-alert message composer — real composed texts.
 *
 * Composes every message type with representative inputs and asserts:
 *   - each text is <= 300 chars (~2 SMS segments)
 *   - no 'undefined'/'NaN' leaks into any text
 *   - signoffs contain counts + PDR confirmation; exceptions name the run
 *     and where to look next
 *
 * Read-only — pure functions, no environment access. Prints each composed
 * text so a human can eyeball readability.
 *
 * Usage:
 *   cd functions
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json \
 *     scripts/verify/ops-sms-alerts-205-compose-texts.ts
 */
import {
  composeIntradaySignoff,
  composePostSignoff,
  composeException,
} from '../../src/v2/common/ops-alerts/ops-alert.composer';

let failures = 0;

function check(desc: string, ok: boolean): void {
  if (ok) {
    console.log(`PASS: ${desc}`);
  } else {
    failures++;
    console.error(`FAIL: ${desc}`);
  }
}

function checkText(label: string, text: string): void {
  console.log(`\n--- ${label} (${text.length} chars) ---`);
  console.log(text);
  check(`${label}: <= 300 chars`, text.length <= 300);
  check(`${label}: no 'undefined' leak`, !text.includes('undefined'));
  check(`${label}: no 'NaN' leak`, !text.includes('NaN'));
}

const DATE = '2026-10-23';

const intradayClean = composeIntradaySignoff({
  marketDate: DATE, clockPt: '0800',
  createdJobs: 42, successJobs: 42, permanentFailureJobs: 0, durationMs: 192_000,
});
checkText('intraday 0800 signoff (clean)', intradayClean);
check('intraday clean: mentions PDR', intradayClean.includes('Partner data-ready message sent'));

const intradayPartial = composeIntradaySignoff({
  marketDate: DATE, clockPt: '1000',
  createdJobs: 42, successJobs: 40, permanentFailureJobs: 2, durationMs: 245_000,
});
checkText('intraday 1000 signoff (2 failures)', intradayPartial);
check('intraday partial: failure count present', intradayPartial.includes('2 failed'));

const postClean = composePostSignoff({
  marketDate: DATE, sequence: 'A',
  intervals: [
    { interval: 'DAILY', createdJobs: 42, successJobs: 42, permanentFailureJobs: 0 },
    { interval: 'WEEKLY', createdJobs: 42, successJobs: 42, permanentFailureJobs: 0 },
    { interval: 'MONTHLY', createdJobs: 42, successJobs: 42, permanentFailureJobs: 0 },
  ],
});
checkText('POST A signoff (clean)', postClean);
check('POST clean: all-intervals language', postClean.includes('scheduled work for the day'));

const postPartial = composePostSignoff({
  marketDate: DATE, sequence: 'A',
  intervals: [
    { interval: 'DAILY', createdJobs: 42, successJobs: 42, permanentFailureJobs: 0 },
    { interval: 'WEEKLY', createdJobs: 42, successJobs: 40, permanentFailureJobs: 2 },
    { interval: 'MONTHLY', createdJobs: 42, successJobs: 41, permanentFailureJobs: 1 },
  ],
});
checkText('POST A signoff (3 failures across intervals)', postPartial);
check('POST partial: total failure count', postPartial.includes('3 failures total'));

const exRunMissing = composeException({
  condition: 'run_missing', marketDate: DATE, clockPt: '0800',
});
checkText('exception run_missing (intraday 0800)', exRunMissing);
check('run_missing: names run + next step', exRunMissing.includes('0800') && exRunMissing.includes('Scheduler'));

const exPdrMissing = composeException({
  condition: 'pdr_missing', marketDate: DATE, sequence: 'C', interval: 'MONTHLY',
  runId: `rt-${DATE}-c-monthly`,
});
checkText('exception pdr_missing (POST C MONTHLY)', exPdrMissing);
check('pdr_missing: names run doc', exPdrMissing.includes(`rt-${DATE}-c-monthly`));

const exNoStart = composeException({
  condition: 'orchestrator_no_start', marketDate: DATE, clockPt: '1200',
});
checkText('exception orchestrator_no_start (intraday 1200)', exNoStart);
check('orchestrator_no_start: names condition', exNoStart.includes('never started'));

const edge = composeIntradaySignoff({ clockPt: '0800' });
checkText('intraday signoff (missing fields edge)', edge);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\n=== All verification checks passed ===');

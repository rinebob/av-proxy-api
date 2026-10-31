/**
 * Verification script for Task #210 — watchdogs emit canonical alert
 * events for hard-down conditions.
 *
 * Calls the real watchdog cores against prod: seeds probe run docs for a
 * future trading date, exercises run_missing / pdr_missing /
 * orchestrator_no_start exception emission, the send-once guard
 * (duplicate invocation re-emits nothing), run-doc stamping, and the
 * no-fabrication guarantee for missing run docs. Cleans up all probes.
 *
 * Mutating: writes + deletes probe docs in realtime-runs, intraday-runs,
 * realtime-health, intraday-health, ops-alerts, and ops-alert-claims.
 * Probe marketDate 2026-12-30 is a real (future) trading day — required
 * because MarketCalendarService throws for years outside its holiday
 * table, and real runs can never exist for a future date. Probe run docs
 * carry runCreatedAt so TTL cleanup reclaims any strays.
 * Not part of run-all.ts.
 *
 * REQUIRES GCLOUD_PROJECT=alpha-vantage-proxy-api — without it, local
 * ADC resolves the dev project (e.g. rel-str) and the checks pass
 * against the wrong database while leaving probe docs behind. The
 * script refuses to run without the override.
 *
 * Usage: GCLOUD_PROJECT=alpha-vantage-proxy-api npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/ops-sms-alerts-210-watchdog-exceptions.ts
 */
import * as admin from 'firebase-admin';
import { db } from '../../src/firebase-admin-init';
import { FirestoreCollection } from '@shared/firestore';
import { checkPostPdrDelivery } from '../../src/v2/alpha-vantage/post-watchdog/post-pdr-watchdog';
import { checkIntradayPdrDelivery } from '../../src/v2/alpha-vantage/intraday-watchdog/intraday-pdr-watchdog';
import { opsAlertKey } from '../../src/v2/common/ops-alerts/ops-alert.types';
import type { OpsExceptionCondition } from '../../src/v2/common/ops-alerts/ops-alert.composer';
import { TimeSeriesRunStatus } from '../../src/v2/alpha-vantage/jobs/time-series-jobs.model';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    // Throw — NOT process.exit — so the try/finally in main() unwinds
    // and probe cleanup still runs on a failed check.
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`PASS: ${message}`);
}

// Probe identity — a real future trading day (calendar-safe, no real
// run docs can exist). 2026-12-30 is a Wednesday.
const MARKET_DATE = '2026-12-30';
const postRunId = (interval: string, clockPt: string) =>
  `${MARKET_DATE}-WED-A-${interval}-LIVE-POST-${clockPt}`;
const POST_DAILY_RUN = `${FirestoreCollection.REALTIME_RUNS}/${postRunId('DAILY', '1335')}`;
const INTRADAY_0800_RUN = `${FirestoreCollection.INTRADAY_RUNS}/${MARKET_DATE}-WED-LIVE-0800`;

const alertDoc = (key: string) => `${FirestoreCollection.OPS_ALERTS}/${key}`;
const claimDoc = (key: string) => `${FirestoreCollection.OPS_ALERT_CLAIMS}/${key}`;

const postKey = (interval: string, condition: OpsExceptionCondition) =>
  opsAlertKey.exceptionPost(MARKET_DATE, 'A', interval, condition);
const intradayKey = (clockPt: string, condition: OpsExceptionCondition) =>
  opsAlertKey.exceptionIntraday(MARKET_DATE, clockPt, condition);

/** Every alertKey this script can produce — pre-cleaned before seeding
 *  and deleted in `finally`, so a crashed prior run can't leave stale
 *  claims that make a rerun pass vacuously or fail spuriously. */
const ALL_KEYS = [
  postKey('daily', 'pdr_missing'),
  postKey('daily', 'orchestrator_no_start'),
  postKey('weekly', 'run_missing'),
  postKey('monthly', 'run_missing'),
  intradayKey('0800', 'orchestrator_no_start'),
  intradayKey('1000', 'run_missing'),
];

async function main() {
  const project = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
  if (project !== 'alpha-vantage-proxy-api') {
    console.error(
      'FAIL: this script mutates prod Firestore and must run with ' +
        `GCLOUD_PROJECT=alpha-vantage-proxy-api (got '${project ?? 'unset'}'). ` +
        'Without the override, local ADC resolves the dev project.',
    );
    process.exit(1);
  }

  try {
    console.log('--- Pre-cleaning any leftover probe alert/claim docs ---');
    for (const key of ALL_KEYS) {
      await db.doc(alertDoc(key)).delete();
      await db.doc(claimDoc(key)).delete();
    }

    console.log('--- Seeding POST-A DAILY probe (jobs, no PDR); WEEKLY/MONTHLY absent ---');
    await db.doc(POST_DAILY_RUN).set({
      runId: postRunId('DAILY', '1335'),
      runType: 'ts-post-all-intervals',
      sequence: 'A',
      marketDate: MARKET_DATE,
      phase: 'POST',
      interval: 'daily',
      status: TimeSeriesRunStatus.COMPLETE,
      probe: true,
      task: 210,
      // Fresh timestamp so cleanupOldRunDocs reclaims any leaked probe.
      runCreatedAt: admin.firestore.Timestamp.now(),
      createdJobs: 5,
      successJobs: 5,
      permanentFailureJobs: 0,
      partnerDataReady: { messageSent: false },
    });

    console.log('\n--- A check: pdr_missing for DAILY, run_missing for WEEKLY/MONTHLY ---');
    await checkPostPdrDelivery({ marketDate: MARKET_DATE });

    const dailyPdrAudit = await db.doc(alertDoc(postKey('daily', 'pdr_missing'))).get();
    assert(dailyPdrAudit.exists, 'audit doc written for daily pdr_missing');
    const ad = dailyPdrAudit.data()!;
    assert(ad.kind === 'exception', 'audit kind is exception');
    assert(
      typeof ad.smsText === 'string' &&
        ad.smsText.includes('POST A DAILY') &&
        ad.smsText.includes('data-ready message was never sent') &&
        ad.smsText.includes('Needs attention'),
      'pdr_missing text names run, expected-vs-actual, and next step',
    );

    const weeklyAudit = await db.doc(alertDoc(postKey('weekly', 'run_missing'))).get();
    assert(weeklyAudit.exists, 'audit doc written for weekly run_missing');
    assert(
      weeklyAudit.data()!.smsText.includes('never ran') &&
        weeklyAudit.data()!.smsText.includes('no run doc exists'),
      'run_missing text names expected-vs-actual + next step',
    );
    assert(
      (await db.doc(alertDoc(postKey('monthly', 'run_missing'))).get()).exists,
      'audit doc written for monthly run_missing',
    );

    for (const key of [
      postKey('daily', 'pdr_missing'),
      postKey('weekly', 'run_missing'),
      postKey('monthly', 'run_missing'),
    ]) {
      const claim = await db.doc(claimDoc(key)).get();
      assert(claim.exists, `claim doc written for ${key}`);
      assert(claim.data()!.kind === 'exception', `claim kind exception for ${key}`);
    }

    const stamped = await db.doc(POST_DAILY_RUN).get();
    assert(
      !!stamped.data()?.opsSms?.claimed?.[postKey('daily', 'pdr_missing')],
      'existing run doc stamped opsSms.claimed[alertKey]',
    );
    const weeklyRun = await db
      .doc(`${FirestoreCollection.REALTIME_RUNS}/${postRunId('WEEKLY', '1335')}`)
      .get();
    assert(!weeklyRun.exists, 'no run doc fabricated for run_missing (WEEKLY)');

    console.log('\n--- Re-run: send-once guard suppresses duplicate emission ---');
    const emittedAt1 = (await db.doc(alertDoc(postKey('daily', 'pdr_missing'))).get()).data()!
      .emittedAt;
    await checkPostPdrDelivery({ marketDate: MARKET_DATE });
    const emittedAt2 = (await db.doc(alertDoc(postKey('daily', 'pdr_missing'))).get()).data()!
      .emittedAt;
    assert(
      emittedAt1?.isEqual?.(emittedAt2) ?? emittedAt1 === emittedAt2,
      'second check does not re-emit — audit emittedAt unchanged',
    );

    console.log('\n--- Zero-job A interval maps to orchestrator_no_start ---');
    await db.doc(POST_DAILY_RUN).update({ createdJobs: 0, successJobs: 0 });
    await checkPostPdrDelivery({ marketDate: MARKET_DATE });
    const orchAudit = await db.doc(alertDoc(postKey('daily', 'orchestrator_no_start'))).get();
    assert(orchAudit.exists, 'audit doc written for daily orchestrator_no_start');
    assert(
      orchAudit.data()!.smsText.includes('never started') &&
        orchAudit.data()!.smsText.includes('no jobs were created'),
      'orchestrator_no_start text distinguishes it from run_missing',
    );

    console.log('\n--- Intraday: zero-job run doc -> orchestrator_no_start ---');
    await db.doc(INTRADAY_0800_RUN).set({
      runId: `${MARKET_DATE}-WED-LIVE-0800`,
      runType: 'intraday',
      marketDate: MARKET_DATE,
      clockPt: '0800',
      status: TimeSeriesRunStatus.IN_PROGRESS,
      probe: true,
      task: 210,
      runCreatedAt: admin.firestore.Timestamp.now(),
      createdJobs: 0,
      partnerDataReady: { messageSent: false },
    });
    await checkIntradayPdrDelivery({ marketDate: MARKET_DATE, clockPt: '0800' });
    const intraAudit = await db.doc(alertDoc(intradayKey('0800', 'orchestrator_no_start'))).get();
    assert(intraAudit.exists, 'audit doc written for intraday orchestrator_no_start');
    assert(
      intraAudit.data()!.smsText.includes('intraday 0800 PT'),
      'intraday exception text names the tick',
    );
    assert(
      (await db.doc(claimDoc(intradayKey('0800', 'orchestrator_no_start'))).get()).exists,
      'claim doc written for intraday orchestrator_no_start',
    );
    const intraStamped = await db.doc(INTRADAY_0800_RUN).get();
    assert(
      !!intraStamped.data()?.opsSms?.claimed?.[intradayKey('0800', 'orchestrator_no_start')],
      'intraday run doc stamped opsSms.claimed[alertKey]',
    );

    console.log('\n--- Intraday: missing run doc -> run_missing, no stamp/fabrication ---');
    await checkIntradayPdrDelivery({ marketDate: MARKET_DATE, clockPt: '1000' });
    const intraMissing = await db.doc(alertDoc(intradayKey('1000', 'run_missing'))).get();
    assert(intraMissing.exists, 'audit doc written for intraday run_missing');
    const intra1000 = await db
      .doc(`${FirestoreCollection.INTRADAY_RUNS}/${MARKET_DATE}-WED-LIVE-1000`)
      .get();
    assert(!intra1000.exists, 'no intraday run doc fabricated for run_missing');

    const health = await db.doc(`${FirestoreCollection.REALTIME_HEALTH}/${MARKET_DATE}`).get();
    assert(health.exists, 'POST health doc still written alongside exception events');
  } finally {
    console.log('\n--- Cleaning up probe docs ---');
    // allSettled: one failed delete must not abort the rest of cleanup.
    // A leftover probe is still reclaimed — run docs carry runCreatedAt
    // for TTL cleanup, and the next run's pre-clean clears alert/claim docs.
    await Promise.allSettled([
      // Probe run docs
      db.doc(POST_DAILY_RUN).delete(),
      db.doc(INTRADAY_0800_RUN).delete(),
      ...['WEEKLY', 'MONTHLY'].map((interval) =>
        db.doc(`${FirestoreCollection.REALTIME_RUNS}/${postRunId(interval, '1335')}`).delete(),
      ),
      db.doc(`${FirestoreCollection.INTRADAY_RUNS}/${MARKET_DATE}-WED-LIVE-1000`).delete(),
      // Health docs
      db.doc(`${FirestoreCollection.REALTIME_HEALTH}/${MARKET_DATE}`).delete(),
      ...['0800', '1000'].map((clockPt) =>
        db.doc(`${FirestoreCollection.INTRADAY_HEALTH}/${MARKET_DATE}-${clockPt}`).delete(),
      ),
      // Alert audit + claim docs
      ...ALL_KEYS.flatMap((key) => [
        db.doc(alertDoc(key)).delete(),
        db.doc(claimDoc(key)).delete(),
      ]),
    ]);
    const gone = await db.doc(alertDoc(postKey('daily', 'pdr_missing'))).get();
    assert(!gone.exists, 'probe alert docs deleted');
  }

  console.log('\n=== All verification checks passed ===');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL: unexpected error', err);
  process.exit(1);
});

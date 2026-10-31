/**
 * Verification script for Task #209 — POST B/C watchdog coverage +
 * POST calendar gate.
 *
 * Calls the real watchdog cores against prod: seeds synthetic B and C
 * sibling run docs for a future trading date, exercises the calendar
 * gate, the B check (incl. the no_jobs empty-retry status), the C
 * target resolution via the real retry-run query, and health doc IDs.
 * Cleans up all probe docs.
 *
 * Mutating: writes + deletes six realtime-runs probe docs and two
 * realtime-health docs in prod. Probe marketDate 2026-12-30 is a real
 * (future) trading day — required because MarketCalendarService throws
 * for years outside its holiday table. The retry-target resolver only
 * accepts candidates <= its todayEt, so the C check is invoked with
 * todayEt = the probe date; conversely the REAL 04:00 orchestrator
 * resolves with real today and can never see these future-dated probes
 * (no mid-run collision hazard). Probe docs carry runCreatedAt so TTL
 * cleanup reclaims any strays. Not part of run-all.ts.
 *
 * REQUIRES GCLOUD_PROJECT=alpha-vantage-proxy-api — without it, local
 * ADC resolves the dev project (e.g. rel-str) and the checks pass
 * against the wrong database while leaving probe docs behind. The
 * script refuses to run without the override.
 *
 * Usage: GCLOUD_PROJECT=alpha-vantage-proxy-api npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/ops-sms-alerts-209-post-bc-watchdog.ts
 */
import * as admin from 'firebase-admin';
import { db } from '../../src/firebase-admin-init';
import { FirestoreCollection } from '@shared/firestore';
import {
  checkPostPdrDelivery,
  checkPostCPdrDelivery,
} from '../../src/v2/alpha-vantage/post-watchdog/post-pdr-watchdog';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    // Throw — NOT process.exit — so the try/finally in main() unwinds
    // and probe cleanup still runs on a failed check.
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`PASS: ${message}`);
}

// Probe identity — a real future trading day (calendar-safe, wins the
// retry-target query). 2026-12-30 is a Wednesday.
const MARKET_DATE = '2026-12-30';
const runId = (seq: string, interval: string, clockPt: string) =>
  `${MARKET_DATE}-WED-${seq}-${interval}-LIVE-POST-${clockPt}`;
const HEALTH_BASE = `${FirestoreCollection.REALTIME_HEALTH}/${MARKET_DATE}`;

const intervalDoc = (
  seq: string,
  interval: string,
  clockPt: string,
  overrides: Record<string, unknown> = {},
) => ({
  runId: runId(seq, interval, clockPt),
  runType: 'ts-post-all-intervals-retry',
  sequence: seq,
  marketDate: MARKET_DATE,
  phase: 'POST',
  interval: interval.toLowerCase(),
  status: 'COMPLETE',
  probe: true,
  task: 209,
  // Fresh timestamp so cleanupOldRunDocs reclaims any leaked probe.
  runCreatedAt: admin.firestore.Timestamp.now(),
  createdJobs: 5,
  successJobs: 5,
  permanentFailureJobs: 0,
  partnerDataReady: { messageSent: true },
  ...overrides,
});

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
  console.log('--- Seeding B probe docs (all PDR sent except MONTHLY zero-job) ---');
  for (const interval of ['DAILY', 'WEEKLY']) {
    await db
      .doc(`${FirestoreCollection.REALTIME_RUNS}/${runId('B', interval, '1800')}`)
      .set(intervalDoc('B', interval, '1800'));
  }
  await db
    .doc(`${FirestoreCollection.REALTIME_RUNS}/${runId('B', 'MONTHLY', '1800')}`)
    .set(
      intervalDoc('B', 'MONTHLY', '1800', {
        createdJobs: 0,
        successJobs: 0,
        partnerDataReady: { messageSent: false },
      }),
    );

  console.log('\n--- B check: sent intervals ok, empty-retry interval no_jobs ---');
  await checkPostPdrDelivery({ marketDate: MARKET_DATE, sequence: 'B', clockPt: '1800' });
  let health = await db.doc(`${HEALTH_BASE}-B`).get();
  assert(health.exists, 'B health doc written at realtime-health/{date}-B');
  let hd = health.data()!;
  assert(hd.sequence === 'B', 'B health doc carries sequence B');
  assert(hd.tickStatus === 'ok', 'B tickStatus ok despite zero-job interval');
  assert(hd.alertState === 'none', 'B alertState none for zero-job interval');
  assert(hd.intervalStatuses?.monthly === 'no_jobs', 'MONTHLY marked no_jobs (empty retry)');
  assert(hd.intervalStatuses?.daily === 'ok' && hd.intervalStatuses?.weekly === 'ok', 'sent intervals ok');

  console.log('\n--- B check: real-jobs interval missing PDR alerts ---');
  await db
    .doc(`${FirestoreCollection.REALTIME_RUNS}/${runId('B', 'WEEKLY', '1800')}`)
    .update({ 'partnerDataReady.messageSent': false });
  await checkPostPdrDelivery({ marketDate: MARKET_DATE, sequence: 'B', clockPt: '1800' });
  health = await db.doc(`${HEALTH_BASE}-B`).get();
  hd = health.data()!;
  assert(hd.tickStatus === 'pdr_missing', 'B tickStatus pdr_missing when real jobs lack PDR');
  assert(hd.intervalStatuses?.weekly === 'pdr_missing', 'WEEKLY flagged pdr_missing');
  await db
    .doc(`${FirestoreCollection.REALTIME_RUNS}/${runId('B', 'WEEKLY', '1800')}`)
    .update({ 'partnerDataReady.messageSent': true });

  console.log('\n--- C check: target resolves via real retry-target query ---');
  for (const interval of ['DAILY', 'WEEKLY', 'MONTHLY']) {
    await db
      .doc(`${FirestoreCollection.REALTIME_RUNS}/${runId('C', interval, '0400')}`)
      .set(intervalDoc('C', interval, '0400'));
  }
  // todayEt = probe date: the resolver validates candidates ≤ todayEt,
  // so real-today resolution would correctly ignore these future-dated
  // probes (they can no longer hijack the real C pass either).
  await checkPostCPdrDelivery({ todayEt: MARKET_DATE });
  health = await db.doc(`${HEALTH_BASE}-C`).get();
  assert(health.exists, 'C health doc written at realtime-health/{date}-C');
  hd = health.data()!;
  assert(hd.sequence === 'C' && hd.clockPt === '0400', 'C health doc carries seq C + clockPt 0400');
  assert(hd.tickStatus === 'ok', 'C tickStatus ok');

  console.log('\n--- Calendar gate: holiday produces zero writes ---');
  const HOLIDAY = '2026-11-26'; // Thanksgiving Thursday — closed
  await checkPostPdrDelivery({ marketDate: HOLIDAY });
  const holidayHealth = await db.doc(`${FirestoreCollection.REALTIME_HEALTH}/${HOLIDAY}`).get();
  assert(!holidayHealth.exists, 'no health doc written on a holiday');
  } finally {
    console.log('\n--- Cleaning up probe docs ---');
    await db.doc(`${HEALTH_BASE}-B`).delete();
    await db.doc(`${HEALTH_BASE}-C`).delete();
    for (const seq of ['B', 'C']) {
      const clockPt = seq === 'B' ? '1800' : '0400';
      for (const interval of ['DAILY', 'WEEKLY', 'MONTHLY']) {
        await db
          .doc(`${FirestoreCollection.REALTIME_RUNS}/${runId(seq, interval, clockPt)}`)
          .delete();
      }
    }
    const gone = await db.doc(`${HEALTH_BASE}-C`).get();
    assert(!gone.exists, 'probe health docs deleted');
  }

  console.log('\n=== All verification checks passed ===');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL: unexpected error', err);
  process.exit(1);
});

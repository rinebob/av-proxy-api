/**
 * Nightly cleanup function for run documents and their jobs subcollections.
 *
 * Deletes realtime-runs and intraday-runs documents (plus all child job docs)
 * older than RUN_DOC_TTL_MS to prevent unbounded Firestore growth.
 *
 * Firestore does not auto-delete subcollection documents when a parent is
 * deleted, so job docs must be explicitly deleted first, in batches of
 * FIRESTORE_BATCH_SIZE.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { Timestamp } from 'firebase-admin/firestore';

import { db } from '../../firebase-admin-init';
import { FirestoreCollection } from '@shared/firestore';
import { betterLogger } from '../utils/utils';
import {
  RUN_DOC_TTL_MS,
  CLEANUP_MAX_RUNS_PER_INVOCATION,
  FIRESTORE_BATCH_SIZE,
} from '../alpha-vantage/jobs/job-config';
import { RUN_DOC_CLEANUP_SCHEDULE } from './function-schedules';

const logger = betterLogger('runDocCleanup');

/**
 * Deletes all documents in a subcollection using batched writes.
 *
 * Firestore batch limit is FIRESTORE_BATCH_SIZE ops; this function loops
 * until all docs in the subcollection have been deleted.
 *
 * @param parentPath Firestore path of the parent document (e.g. "realtime-runs/some-run-id").
 * @param subcollectionName Name of the subcollection to delete (e.g. "jobs").
 * @returns Total number of docs deleted.
 */
async function deleteSubcollection(
  parentPath: string,
  subcollectionName: string,
): Promise<number> {
  const colRef = db.collection(`${parentPath}/${subcollectionName}`);
  let totalDeleted = 0;

  // Reason: Firestore batch size is capped at 500; loop until exhausted.
  while (true) {
    const snap = await colRef.limit(FIRESTORE_BATCH_SIZE).get();
    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((doc: FirebaseFirestore.QueryDocumentSnapshot) => batch.delete(doc.ref));
    await batch.commit();
    totalDeleted += snap.size;
  }

  return totalDeleted;
}

/**
 * Deletes all run documents (and their jobs subcollections) in a given
 * collection that are older than the cutoff timestamp.
 *
 * @param collectionName Firestore collection name (e.g. "realtime-runs").
 * @param cutoff Timestamp before which run docs are considered expired.
 * @returns Counts of deleted run docs and job docs.
 */
async function cleanupCollection(
  collectionName: string,
  cutoff: Timestamp,
): Promise<{ runsDeleted: number; jobsDeleted: number }> {
  let runsDeleted = 0;
  let jobsDeleted = 0;

  const snap = await db
    .collection(collectionName)
    .where('runCreatedAt', '<', cutoff)
    .limit(CLEANUP_MAX_RUNS_PER_INVOCATION)
    .get();

  if (snap.empty) {
    logger.info('run-doc-cleanup.collection.none_expired', { collectionName } as any);
    return { runsDeleted, jobsDeleted };
  }

  logger.info('run-doc-cleanup.collection.found', {
    collectionName,
    count: snap.size,
  } as any);

  for (const runDoc of snap.docs) {
    const runPath = runDoc.ref.path;

    // Delete job subcollection first — Firestore won't cascade.
    const deleted = await deleteSubcollection(runPath, FirestoreCollection.JOBS);
    jobsDeleted += deleted;

    await runDoc.ref.delete();
    runsDeleted += 1;
  }

  return { runsDeleted, jobsDeleted };
}

/**
 * Scheduled Cloud Function: delete expired run documents nightly.
 *
 * Runs at 2:00 AM ET every day. Cleans up both `realtime-runs` and
 * `intraday-runs` collections, deleting run docs and all child job docs
 * older than RUN_DOC_TTL_MS (2 days).
 */
export const cleanupOldRunDocs = onSchedule(
  {
    schedule: RUN_DOC_CLEANUP_SCHEDULE,
    timeZone: 'America/New_York',
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const cutoffMs = Date.now() - RUN_DOC_TTL_MS;
    const cutoff = Timestamp.fromMillis(cutoffMs);

    logger.info('run-doc-cleanup.start', {
      cutoff: new Date(cutoffMs).toISOString(),
      ttlDays: RUN_DOC_TTL_MS / (24 * 60 * 60 * 1000),
    } as any);

    const [realtimeResult, intradayResult] = await Promise.all([
      cleanupCollection(FirestoreCollection.REALTIME_RUNS, cutoff),
      cleanupCollection(FirestoreCollection.INTRADAY_RUNS, cutoff),
    ]);

    logger.info('run-doc-cleanup.complete', {
      realtimeRunsDeleted: realtimeResult.runsDeleted,
      realtimeJobsDeleted: realtimeResult.jobsDeleted,
      intradayRunsDeleted: intradayResult.runsDeleted,
      intradayJobsDeleted: intradayResult.jobsDeleted,
      totalDocsDeleted:
        realtimeResult.runsDeleted +
        realtimeResult.jobsDeleted +
        intradayResult.runsDeleted +
        intradayResult.jobsDeleted,
    } as any);
  },
);

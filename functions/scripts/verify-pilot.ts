import { admin } from '../src/firebase-admin-init';

const runId = process.env.RUN_ID || 'options_corpus_runs-QQQ-TQQQ-2019-01-01-2026-07-20-md20-pilot';

async function main(): Promise<void> {
  const db = admin.firestore();

  const runDoc = await db.collection('options_corpus_runs').doc(runId).get();
  if (!runDoc.exists) {
    console.log(`Run doc ${runId} not found`);
    return;
  }
  console.log('runDoc:', JSON.stringify(runDoc.data(), null, 2));

  const itemsSnap = await db.collection('options_corpus_runs').doc(runId).collection('items').get();
  const statuses: Record<string, number> = {};
  itemsSnap.forEach((doc) => {
    const data = doc.data();
    const status = data?.status || 'unknown';
    statuses[status] = (statuses[status] || 0) + 1;
  });

  console.log(`Total items: ${itemsSnap.size}`);
  console.log('Status counts:', JSON.stringify(statuses, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

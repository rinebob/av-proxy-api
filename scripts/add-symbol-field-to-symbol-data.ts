import { db } from '../functions/src/firebase-admin-init';

async function addSymbolFieldToSymbolData(): Promise<void> {
  console.log('Starting symbol field backfill on symbol-data collection...');

  try {
    const collectionName = 'symbol-data';
    const BATCH_SIZE = 500;

    console.log(`Loading documents from collection '${collectionName}'...`);
    const snapshot = await db.collection(collectionName).get();
    const totalDocs = snapshot.size;

    if (totalDocs === 0) {
      console.log('No documents found in symbol-data. Nothing to update.');
      return;
    }

    console.log(`Found ${totalDocs} documents to inspect.`);

    let updatedCount = 0;
    let skippedCount = 0;
    let operationCount = 0;
    let currentBatch = db.batch();

    for (const doc of snapshot.docs) {
      const docId = doc.id;
      const upperSymbol = docId.toUpperCase();
      const existing = doc.get('symbol');

      // If symbol already exists and matches the desired value, skip.
      if (typeof existing === 'string' && existing.toUpperCase() === upperSymbol) {
        skippedCount++;
        continue;
      }

      currentBatch.update(doc.ref, { symbol: upperSymbol });
      updatedCount++;
      operationCount++;

      if (operationCount >= BATCH_SIZE) {
        console.log(`Committing batch of ${operationCount} updates...`);
        await currentBatch.commit();
        currentBatch = db.batch();
        operationCount = 0;
      }
    }

    if (operationCount > 0) {
      console.log(`Committing final batch of ${operationCount} updates...`);
      await currentBatch.commit();
    }

    console.log('--- Backfill complete ---');
    console.log(`Total docs scanned: ${totalDocs}`);
    console.log(`Docs updated with symbol field: ${updatedCount}`);
    console.log(`Docs skipped (already up-to-date): ${skippedCount}`);
  } catch (error) {
    console.error('Error while backfilling symbol field on symbol-data:', error);
    process.exitCode = 1;
  }
}

// Execute when run via ts-node
addSymbolFieldToSymbolData().catch((err) => {
  console.error('Unhandled error in add-symbol-field-to-symbol-data script:', err);
  process.exitCode = 1;
});

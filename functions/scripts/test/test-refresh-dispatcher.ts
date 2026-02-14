// Set emulator env and load local .env before any Firebase/Admin imports
import * as dotenv from 'dotenv';
import * as path from 'path';
import { setupEmulator } from '../scripts-util';
setupEmulator();
{
  // Load only the current convention: local-dev.env.alpha-vantage-proxy-api
  const localDevPath = path.resolve(__dirname, '..', 'local-dev.env.alpha-vantage-proxy-api');
  const fs = require('fs');
  if (fs.existsSync(localDevPath)) {
    console.log(`[dispatcher] loading env from: ${path.basename(localDevPath)}`);
    dotenv.config({ path: localDevPath });
  } else {
    console.warn('[dispatcher] WARNING: functions/local-dev.env.alpha-vantage-proxy-api not found.');
    console.warn('Ensure this file exists with LOCAL_EMULATOR_ALPHAVANTAGE_API_KEY and GCLOUD_PROJECT=alpha-vantage-proxy-api');
  }
}

// Firebase Admin (centralized init used by other scripts)
import { db, admin } from '../src/firebase-admin-init';

// v2 refresh runner (Alpha Vantage)
import { runRefreshAlphaVantageDataV2 } from '../src/v2/alpha-vantage/data-refresher/av-refresh-manager';

// Shared Firestore enums and helpers
import { FirestoreCollection } from '@shared/firestore';
import { AlphaVantageEndpoint } from '@shared/alpha-vantage';
import { ApiProvider } from '@shared/core';
import { getSymbolTimeSeriesDocPath } from '../src/v2/common/firestore/firestore-paths';

// Test symbol (can be overridden by CLI arg: npx ts-node scripts/test-refresh-dispatcher.ts MSFT)
const TEST_SYMBOL = (process.argv[2] || 'AAPL').toUpperCase();

async function ensureTrackedSymbol(symbol: string) {
  const ref = db.collection(FirestoreCollection.TRACKED_SYMBOLS).doc(symbol);
  const snap = await ref.get();
  if (!snap.exists) {
    console.log(`[dispatcher] adding ${symbol} to ${FirestoreCollection.TRACKED_SYMBOLS}...`);
    await ref.set({
      symbol,
      isActive: true,
      _createdAt: admin.firestore.FieldValue.serverTimestamp(),
      _lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } else {
    console.log(`[dispatcher] ${symbol} already present in ${FirestoreCollection.TRACKED_SYMBOLS}`);
  }
}

async function verifyDailyAdjusted(symbol: string) {
  try {
    const docPath = getSymbolTimeSeriesDocPath(symbol, AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED as any, ApiProvider.ALPHA_VANTAGE);
    const snap = await db.doc(docPath).get();
    if (!snap.exists) {
      console.log(`❌ Daily Adjusted doc not found for ${symbol}: ${docPath}`);
      return false;
    }
    const data = snap.data() as any;
    const last = data?.metadata?.lastUpdated;
    const next = data?.metadata?.nextRefreshAt;
    const toIso = (t: any) => t?.toDate?.() ? t.toDate().toISOString() : (t ? String(t) : 'n/a');
    console.log(`✅ Found Daily Adjusted metadata for ${symbol}`);
    console.log(`   lastUpdated=${toIso(last)} nextRefreshAt=${toIso(next)} ttlSeconds=${data?.metadata?.ttlSeconds ?? 'n/a'}`);
    return true;
  } catch (e: any) {
    console.log('verifyDailyAdjusted error:', e?.message || e);
    return false;
  }
}

async function main() {
  console.log('[dispatcher] start');
  await ensureTrackedSymbol(TEST_SYMBOL);

  // Force a refresh cycle using the v2 manager
  console.log('[dispatcher] running runRefreshAlphaVantageDataV2({ force: true })...');
  const result = await runRefreshAlphaVantageDataV2({ force: true });
  console.log('[dispatcher] refresh result:', result);

  // Basic verification (time-series daily-adjusted top-level doc)
  await verifyDailyAdjusted(TEST_SYMBOL);

  console.log('[dispatcher] done');
}

main().catch(err => {
  console.error('[dispatcher] fatal:', err?.message || err);
  process.exit(1);
});

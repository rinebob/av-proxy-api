// Set env vars / emulator BEFORE other imports
import * as dotenv from 'dotenv';
import * as path from 'path';
import { setupEmulator } from '../scripts-util';

setupEmulator();
dotenv.config({ path: path.resolve(__dirname, '..', '.env.alpha-vantage-proxy-api') });

import { db } from '../../src/firebase-admin-init';
import { FirestoreCollection } from '@shared/firestore';
import { ApiProvider } from '@shared/core';
import { AlphaVantageEndpoint, TimeSeriesInterval } from '@shared/alpha-vantage';
import { getSymbolTimeSeriesDocPath, getSymbolTimeSeriesYearDocPath, getSymbolTimeSeriesAllDocPath } from '../../src/v2/common/firestore/firestore-paths';

interface SeriesConfig {
  endpoint: AlphaVantageEndpoint;
  interval: TimeSeriesInterval;
}

const SERIES_CONFIGS: SeriesConfig[] = [
  { endpoint: AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED, interval: TimeSeriesInterval.DAILY },
  { endpoint: AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED, interval: TimeSeriesInterval.WEEKLY },
  { endpoint: AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED, interval: TimeSeriesInterval.MONTHLY },
];

async function getSymbols(): Promise<string[]> {
  if (process.env.SYMBOL) {
    return [process.env.SYMBOL.toUpperCase()];
  }
  if (process.env.SYMBOLS) {
    return process.env.SYMBOLS.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  }
  const snapshot = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
  return snapshot.docs.map(d => d.id).sort();
}

async function repairSeriesForSymbol(symbol: string): Promise<number> {
  let updates = 0;
  for (const cfg of SERIES_CONFIGS) {
    for (const isSplitAdjusted of [false, true]) {
      const metaPath = getSymbolTimeSeriesDocPath(symbol, cfg.endpoint, ApiProvider.ALPHA_VANTAGE, isSplitAdjusted);
      const metaRef = db.doc(metaPath);
      const metaSnap = await metaRef.get();
      if (!metaSnap.exists) continue;
      const metaData = metaSnap.data() as any;

      let allTs: number[] = [];
      let years: number[] = [];

      if (cfg.interval === TimeSeriesInterval.MONTHLY) {
        const allPath = getSymbolTimeSeriesAllDocPath(symbol, cfg.endpoint, ApiProvider.ALPHA_VANTAGE, isSplitAdjusted);
        const allSnap = await db.doc(allPath).get();
        if (!allSnap.exists) continue;
        const allData = allSnap.data() as any;
        const bars = Array.isArray(allData?.bars) ? allData.bars as any[] : [];
        const yearSet = new Set<number>();
        for (const b of bars) {
          const t = Number(b?.t);
          if (!Number.isFinite(t)) continue;
          allTs.push(t);
          const y = new Date(t).getUTCFullYear();
          if (Number.isFinite(y)) yearSet.add(y);
        }
        years = Array.from(yearSet).sort((a, b) => a - b);
      } else {
        const yearsColPath = `${metaPath}/years`;
        const yearsSnap = await db.collection(yearsColPath).get();
        years = yearsSnap.docs.map(d => Number(d.id)).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
        for (const year of years) {
          const yPath = getSymbolTimeSeriesYearDocPath(symbol, cfg.endpoint, ApiProvider.ALPHA_VANTAGE, year, isSplitAdjusted);
          const ySnap = await db.doc(yPath).get();
          if (!ySnap.exists) continue;
          const yData = ySnap.data() as any;
          const bars = Array.isArray(yData?.bars) ? yData.bars as any[] : [];
          for (const b of bars) {
            const t = Number(b?.t);
            if (Number.isFinite(t)) allTs.push(t);
          }
        }
      }

      if (!allTs.length) continue;

      const minTs = Math.min(...allTs);
      const maxTs = Math.max(...allTs);

      const existingMeta = metaData?.metadata || {};
      const newMeta = {
        ...existingMeta,
        histStartTs: minTs,
        histEndTs: maxTs,
        availableYears: years,
      };

      await metaRef.set({
        metadata: newMeta,
        latestBarTimestamp: maxTs ? (metaData?.latestBarTimestamp || null) : null,
      }, { merge: true });

      console.log(`[REPAIR] ${symbol} ${AlphaVantageEndpoint[cfg.endpoint]} adj=${isSplitAdjusted} histStartTs=${minTs} histEndTs=${maxTs} years=${JSON.stringify(years)}`);
      updates++;
    }
  }
  return updates;
}

async function main() {
  const symbols = await getSymbols();
  console.log(`--- repair-timeseries-metadata: ${symbols.length} symbol(s) ---`);
  let totalUpdates = 0;
  for (const symbol of symbols) {
    const u = await repairSeriesForSymbol(symbol);
    console.log(`[${symbol}] updatedSeries=${u}`);
    totalUpdates += u;
  }
  console.log(`Total series updated: ${totalUpdates}`);
}

main().catch((err) => {
  console.error('repair-timeseries-metadata error', err);
  process.exit(1);
});

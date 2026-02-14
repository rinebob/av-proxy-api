
import 'dotenv/config';
import { db } from '../src/firebase-admin-init';
import { FirestoreCollection } from '@shared/firestore';
import { getSymbolTimeSeriesYearDocPath, getSymbolTimeSeriesAllDocPath } from '../src/v2/common/firestore/firestore-paths';
import { AlphaVantageEndpoint } from '@shared/alpha-vantage';
import { ApiProvider } from '@shared/core';

async function main() {
  const args = process.argv.slice(2);
  const inspectIndex = args.indexOf('--inspect');
  const inspectDate = inspectIndex !== -1 ? args[inspectIndex + 1] : null;

  console.log(`--- Verifying Data Integrity (Splits & Spikes) ---`);
  if (inspectDate) console.log(`Mode: Inspecting Bar ${inspectDate}`);

  // 1. Get Symbols
  let symbols: string[] = [];
  if (process.env.SYMBOL) {
    symbols = [process.env.SYMBOL];
  } else if (process.env.SYMBOLS) {
    symbols = process.env.SYMBOLS.split(',');
  } else {
    const snapshot = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
    symbols = snapshot.docs.map(d => d.id).sort();
  }
  console.log(`Found ${symbols.length} symbols.`);

  let totalChecks = 0;
  let failures = 0;

  for (const symbol of symbols) {
    console.log(`\n[${symbol}]`);
    
    if (inspectDate) {
        // Inspect Specific Bar
        const dateObj = new Date(inspectDate);
        const year = dateObj.getFullYear();
        
        // Check Daily
        const dailyPath = getSymbolTimeSeriesYearDocPath(symbol, AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED, ApiProvider.ALPHA_VANTAGE, year, true);
        const dailyDoc = await db.doc(dailyPath).get();
        const dailyBars = (dailyDoc.data()?.bars || []) as any[];
        
        const targetIndex = dailyBars.findIndex(b => b.d === inspectDate);
        
        if (targetIndex !== -1) {
            console.log(`  Context for ${inspectDate}:`);
            const indices = [targetIndex - 1, targetIndex, targetIndex + 1];
            
            for (const idx of indices) {
                if (idx >= 0 && idx < dailyBars.length) {
                    const bar = dailyBars[idx];
                    const label = idx === targetIndex ? '>> TARGET' : idx < targetIndex ? '   PREV  ' : '   NEXT  ';
                    console.log(`  ${label} ${bar.d}: O=${bar.o} H=${bar.h} L=${bar.l} C=${bar.c}`);
                }
            }
        } else {
            console.log(`  Daily ${inspectDate}: Not found.`);
        }
        continue; // Skip standard verification in inspect mode
    }

    // --- 1. Split Ratio Verification ---
    const symbolDoc = await db.doc(`${FirestoreCollection.SYMBOL_DATA}/${symbol}`).get();
    const splitHistory = (symbolDoc.data()?.splitHistory || []) as { date: string, factor: number }[];
    splitHistory.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    if (splitHistory.length > 0) {
      console.log(`  Splits: ${splitHistory.length}`);
      for (const split of splitHistory) {
        const splitDate = split.date;
        const beforeDate = new Date(splitDate);
        beforeDate.setDate(beforeDate.getDate() - 7);
        const checkYear = beforeDate.getFullYear();

        // Use Weekly for verification as it's granular enough but faster than Daily
        const rawPath = getSymbolTimeSeriesYearDocPath(symbol, AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED, ApiProvider.ALPHA_VANTAGE, checkYear, false);
        const adjPath = getSymbolTimeSeriesYearDocPath(symbol, AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED, ApiProvider.ALPHA_VANTAGE, checkYear, true);

        const [rawDoc, adjDoc] = await Promise.all([db.doc(rawPath).get(), db.doc(adjPath).get()]);
        const rawBars = (rawDoc.data()?.bars || []) as any[];
        const adjBars = (adjDoc.data()?.bars || []) as any[];

        const rawBar = [...rawBars].reverse().find(b => b.d < splitDate);
        const adjBar = [...adjBars].reverse().find(b => b.d < splitDate);

        if (rawBar && adjBar && rawBar.d === adjBar.d) {
          let expectedFactor = 1;
          for (const s of splitHistory) {
            if (s.date > rawBar.d) expectedFactor *= s.factor;
          }
          const actualRatio = rawBar.c / adjBar.c;
          const percentDiff = Math.abs((actualRatio - expectedFactor) / expectedFactor);
          const pass = percentDiff < 0.01;
          totalChecks++;
          
          if (pass) {
            console.log(`    ✓ Ratio ${splitDate} (x${split.factor}): Bar ${rawBar.d}`);
            console.log(`      Raw C=${rawBar.c} Adj C=${adjBar.c} Ratio=${actualRatio.toFixed(2)} Exp=${expectedFactor.toFixed(2)}`);
          } else {
            console.error(`    ✕ Ratio ${splitDate} (x${split.factor}): Bar ${rawBar.d}`);
            console.log(`      Raw C=${rawBar.c} Adj C=${adjBar.c} Ratio=${actualRatio.toFixed(2)} Exp=${expectedFactor.toFixed(2)} (Diff ${(percentDiff*100).toFixed(1)}%)`);
            failures++;
          }
        } else {
            // console.warn(`    ! No pre-split history for ${splitDate}`);
        }
      }
    } else {
      console.log(`  No splits.`);
    }

    // --- 2. Spike Detection (Hybrid Bars) ---
    // Check Monthly data for the month of each split
    if (splitHistory.length > 0) {
      const monthlyPath = getSymbolTimeSeriesAllDocPath(symbol, AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED, ApiProvider.ALPHA_VANTAGE, true);
      const monthlyDoc = await db.doc(monthlyPath).get();
      const monthlyBars = (monthlyDoc.data()?.bars || []) as any[];

      for (const split of splitHistory) {
        const splitDate = split.date;
        const splitMonth = splitDate.substring(0, 7); // YYYY-MM
        const hybridBar = monthlyBars.find(b => b.d.startsWith(splitMonth));
        
        if (hybridBar) {
            const ratio = hybridBar.h / hybridBar.c;
            // A spike is detected if High/Close ratio is large (close to split factor) for a split >= 2:1
            if (split.factor >= 2 && ratio > 1.5) {
                 console.error(`    ✕ Spike Detected ${split.date}: Bar ${hybridBar.d}`);
                 console.log(`      O=${hybridBar.o} H=${hybridBar.h} L=${hybridBar.l} C=${hybridBar.c} Ratio=${ratio.toFixed(2)}`);
                 failures++;
            } else {
                 console.log(`    ✓ Spike Check ${split.date}: Bar ${hybridBar.d}`);
                 console.log(`      O=${hybridBar.o} H=${hybridBar.h} L=${hybridBar.l} C=${hybridBar.c} Ratio=${ratio.toFixed(2)}`);
            }
            totalChecks++;
        }
      }
    }
  }

  console.log(`\nTotal Checks: ${totalChecks}`);
  console.log(`Failures: ${failures}`);
  if (failures > 0) process.exit(1);
}

main().catch(console.error);

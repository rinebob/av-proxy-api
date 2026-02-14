// Emulator wiring must happen before importing firebase-admin-init.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { setupEmulator } = require('../scripts-util');
setupEmulator();

import 'dotenv/config';
import { db } from '../src/firebase-admin-init';
import { FirestoreCollection } from '@shared/firestore';
import axios from 'axios';
import { Timestamp } from 'firebase-admin/firestore';

// Known Patches: Map<Symbol, Map<Date, NewFactor>>
const SPLIT_PATCHES: Record<string, Record<string, number>> = {
  'GOOGL': {
      '2014-04-03': 2.0
  }
};

async function main() {
  console.log(`--- Sync Splits from Alpha Vantage (SoT) ---`);
  
  let symbols: string[] = [];
  if (process.env.SYMBOL) {
    symbols = [process.env.SYMBOL];
  } else if (process.env.SYMBOLS) {
    symbols = process.env.SYMBOLS.split(',');
  } else {
    const snapshot = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
    symbols = snapshot.docs.map(d => d.id).sort();
  }
  
  console.log(`Processing ${symbols.length} symbols...`);
  
  const apiKey = process.env.ALPHAVANTAGE_API_KEY;
  if (!apiKey) {
      console.error('ALPHAVANTAGE_API_KEY required.');
      process.exit(1);
  }

  for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];
      console.log(`[${i+1}/${symbols.length}] Syncing ${symbol}...`);
      
      try {
          const url = `https://www.alphavantage.co/query?function=SPLITS&symbol=${symbol}&apikey=${apiKey}`;
          const res = await axios.get(url);
          const data = res.data;
          
          if (!data || !data.data) {
              console.log(`  No split data (or error). Response:`, JSON.stringify(data).slice(0, 100));
              // If empty data "data": [], it means no splits. We should clear history.
              if (Array.isArray(data.data) && data.data.length === 0) {
                  await saveHistory(symbol, []);
              }
              continue;
          }
          
          const rawSplits = data.data; // [{ effective_date, split_factor }]
          
          // Transform and Patch
          const cleanSplits = rawSplits.map((s: any) => {
              let factor = parseFloat(s.split_factor);
              const date = s.effective_date;
              
              // Apply Patch
              if (SPLIT_PATCHES[symbol] && SPLIT_PATCHES[symbol][date]) {
                  const oldFactor = factor;
                  factor = SPLIT_PATCHES[symbol][date];
                  console.log(`  Applied Patch for ${date}: ${oldFactor} -> ${factor}`);
              }
              
              return {
                  date,
                  factor,
                  detectedAt: Timestamp.now(),
                  status: 'SYNCED_FROM_AV'
              };
          });
          
          // Sort ascending
          cleanSplits.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
          
          console.log(`  Found ${cleanSplits.length} splits.`);
          await saveHistory(symbol, cleanSplits);
          
      } catch (err: any) {
          console.error(`  ✕ Failed ${symbol}:`, err.message);
      }
      
      // Rate limit
      await new Promise(r => setTimeout(r, 2000));
  }
  
  console.log('\n--- Sync Complete ---');
}

async function saveHistory(symbol: string, history: any[]) {
    await db.doc(`${FirestoreCollection.SYMBOL_DATA}/${symbol}`).set({ 
        splitHistory: history 
    }, { merge: true });
    console.log('  ✓ History Updated.');
}

main().catch(console.error);

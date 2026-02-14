
import 'dotenv/config';
import { db } from '../src/firebase-admin-init';
import { FirestoreCollection } from '@shared/firestore';
import axios from 'axios';
import { Timestamp } from 'firebase-admin/firestore';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  console.log(`--- Manage Splits Tool ---`);
  
  if (command === 'clean') {
      await cleanSplits();
  } else if (command === 'patch') {
      // usage: patch SYMBOL DATE FACTOR
      const symbol = args[1];
      const date = args[2];
      const factor = parseFloat(args[3]);
      if (!symbol || !date || !factor) {
          console.error('Usage: patch <symbol> <date> <factor>');
          return;
      }
      await patchSplit(symbol, date, factor);
  } else if (command === 'remove') {
      const symbol = args[1];
      const date = args[2];
      if (!symbol || !date) {
          console.error('Usage: remove <symbol> <date>');
          return;
      }
      await removeSplit(symbol, date);
  } else if (command === 'fetch') {
      const symbol = args[1];
      if (!symbol) {
          console.error('Usage: fetch <symbol>');
          return;
      }
      await fetchSplits(symbol);
  } else if (command === 'analyze') {
      await analyzeSplits();
  } else {
      console.log('Commands: clean, patch, fetch, analyze');
  }
}

// --- Logic from clean-split-history.ts ---
async function cleanSplits() {
  console.log('Cleaning duplicates...');
  const snapshot = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
  const symbols = snapshot.docs.map(d => d.id).sort();
  let cleanedCount = 0;

  for (const symbol of symbols) {
      const docRef = db.doc(`${FirestoreCollection.SYMBOL_DATA}/${symbol}`);
      const doc = await docRef.get();
      const history = (doc.data()?.splitHistory || []) as { date: string, factor: number }[];
      if (history.length === 0) continue;

      const uniqueMap = new Map<string, any>();
      for (const s of history) {
          const existing = uniqueMap.get(s.date);
          if (!existing) {
              uniqueMap.set(s.date, s);
          } else {
              if (s.factor > 1 && existing.factor === 1) uniqueMap.set(s.date, s); // Prefer actual split
          }
      }
      const uniqueHistory = Array.from(uniqueMap.values());
      uniqueHistory.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      
      if (uniqueHistory.length < history.length) {
          // Diagnostic-only: report what would be cleaned, but do not write.
          console.log(`[${symbol}] WOULD clean duplicates: ${history.length} -> ${uniqueHistory.length}`);
          cleanedCount++;
      }
  }
  console.log(`Cleaned ${cleanedCount} symbols.`);
}

// --- Logic from patch-googl-split.ts ---
async function patchSplit(symbol: string, date: string, factor: number) {
  console.log(`Patching ${symbol} split on ${date} to factor ${factor}...`);
  const docRef = db.doc(`${FirestoreCollection.SYMBOL_DATA}/${symbol}`);
  const doc = await docRef.get();
  if (!doc.exists) { console.error('Symbol not found'); return; }
  
  const history = (doc.data()?.splitHistory || []) as any[];
  let found = false;
  const updatedHistory = history.map(s => {
      if (s.date === date) {
          console.log(`Found ${date}. Updating factor ${s.factor} -> ${factor}`);
          found = true;
          return { ...s, factor };
      }
      return s;
  });
  
  if (!found) {
      console.log(`Split not found. Adding new entry.`);
      updatedHistory.push({ date, factor, detectedAt: Timestamp.now(), status: 'MANUAL_PATCH' });
      updatedHistory.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  // Diagnostic-only: show the proposed new history length, but do not persist.
  console.log(`WOULD save patched history for ${symbol}: ${history.length} -> ${updatedHistory.length} entries.`);
}

async function removeSplit(symbol: string, date: string) {
  console.log(`Removing ${symbol} split on ${date}...`);
  const docRef = db.doc(`${FirestoreCollection.SYMBOL_DATA}/${symbol}`);
  const doc = await docRef.get();
  if (!doc.exists) { console.error('Symbol not found'); return; }
  
  const history = (doc.data()?.splitHistory || []) as any[];
  const updatedHistory = history.filter(s => s.date !== date);
  
  if (updatedHistory.length < history.length) {
      // Diagnostic-only: log what would be removed.
      console.log(`WOULD remove ${symbol} split on ${date}. Count: ${history.length} -> ${updatedHistory.length}`);
  } else {
      console.log('Split not found.');
  }
}

// --- Logic from debug-splits.ts ---
async function fetchSplits(symbol: string) {
  const apiKey = process.env.ALPHAVANTAGE_API_KEY;
  const url = `https://www.alphavantage.co/query?function=SPLITS&symbol=${symbol}&apikey=${apiKey}`;
  console.log(`Fetching ${url}...`);
  try {
    const res = await axios.get(url);
    console.log('Response:', JSON.stringify(res.data, null, 2));
  } catch (err: any) {
    console.error('Error:', err.message);
  }
}

// --- Logic from analyze-split-dates.ts ---
async function analyzeSplits() {
  console.log('Analyzing split dates...');
  const snapshot = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
  const symbols = snapshot.docs.map(d => d.id).sort();
  let earliest: Date | null = null;
  let earliestSym = '';
  
  for (const symbol of symbols) {
      const doc = await db.doc(`${FirestoreCollection.SYMBOL_DATA}/${symbol}`).get();
      const history = (doc.data()?.splitHistory || []) as { date: string }[];
      if (history.length > 0) {
          history.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
          const first = new Date(history[0].date);
          if (!earliest || first < earliest) {
              earliest = first;
              earliestSym = symbol;
          }
          console.log(`[${symbol}] ${history.length} splits. First: ${history[0].date}`);
      }
  }
  
  if (earliest) {
      const years = (Date.now() - earliest.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
      console.log(`\nEarliest Split: ${earliest.toISOString().slice(0,10)} (${earliestSym})`);
      console.log(`Years Ago: ${years.toFixed(2)}`);
  }
}

main().catch(console.error);

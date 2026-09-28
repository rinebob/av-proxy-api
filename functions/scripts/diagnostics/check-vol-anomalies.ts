// Follow-up: print bars around the anomalous jump + last 8 bars per suspect
// to see whether the level reverted (bad bar) or persisted (split/corrupted segment).
// Read-only. Run from functions/: npx ts-node --transpile-only scripts/diagnostics/check-vol-anomalies.ts
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'alpha-vantage-proxy-api' });
}
const db = admin.firestore();

const SUSPECTS: Record<string, string> = {
  BK: '2026-06-05',
  CRWD: '2026-07-02',
  APH: '2026-09-03',
  MNST: '2026-08-11',
  EYPT: '2026-08-17',
  MRNA: '2026-08-19',
};

async function main(): Promise<void> {
  for (const [symbol, jumpDate] of Object.entries(SUSPECTS)) {
    const snaps = await Promise.all(
      [2025, 2026].map((y) =>
        db.doc(`symbol-data/${symbol}/sa-time-series/av-daily-adjusted/years/${y}`).get()
      )
    );
    const barMap = new Map<number, number>();
    for (const snap of snaps) {
      const bars = (snap.exists ? snap.data()?.bars : undefined) ?? [];
      for (const b of bars) {
        const ts = Number(b?.t);
        const c = Number(b?.c);
        if (Number.isFinite(ts) && Number.isFinite(c) && c > 0) barMap.set(ts, c);
      }
    }
    const sorted = [...barMap.entries()].sort((a, b) => a[0] - b[0]);
    const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
    const jumpTs = Date.parse(`${jumpDate}T00:00:00.000Z`);
    const idx = sorted.findIndex(([t]) => t === jumpTs);

    console.log(`\n=== ${symbol} === jump ${jumpDate} idx=${idx}/${sorted.length}`);
    if (idx >= 0) {
      const lo = Math.max(0, idx - 3);
      const hi = Math.min(sorted.length, idx + 6);
      console.log('  around jump:');
      for (let i = lo; i < hi; i++) {
        const marker = i === idx ? ' <==' : '';
        console.log(`    ${iso(sorted[i][0])}  ${sorted[i][1].toFixed(2)}${marker}`);
      }
    }
    console.log('  last 8 bars:');
    for (const [t, c] of sorted.slice(-8)) {
      console.log(`    ${iso(t)}  ${c.toFixed(2)}`);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('fatal', (e && e.message) || e);
  process.exit(1);
});

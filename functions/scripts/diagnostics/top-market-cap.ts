// One-off diagnostic: rank tracked symbols by MarketCapitalization and report
// volatility measures. Read-only.
//   market cap + Beta: symbol-data/{SYM}/company-overview/av-company-overview (data.*)
//   realized vol:      daily-adjusted bars at
//                      symbol-data/{SYM}/sa-time-series/av-daily-adjusted/years/{YEAR}
//                      annualized stdev of daily log returns (x sqrt(252))
// Run from functions/: npx ts-node --transpile-only scripts/diagnostics/top-market-cap.ts
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'alpha-vantage-proxy-api' });
}
const db = admin.firestore();

const fmtCap = (n: number): string =>
  n >= 1e12 ? `$${(n / 1e12).toFixed(2)}T` : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : `$${(n / 1e6).toFixed(0)}M`;

const fmtPct = (n: number | null): string => (n == null ? '-' : `${(n * 100).toFixed(1)}%`);

/** Annualized realized vol from an array of log returns. */
function annualizedVol(rets: number[]): number | null {
  if (rets.length < 20) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

interface Row {
  symbol: string;
  name: string;
  sector: string;
  marketCap: number | null;
  beta: number | null;
  vol60d: number | null;
  vol1y: number | null;
  bars: number;
}

async function main(): Promise<void> {
  const tracked = await db.collection('tracked-symbols').get();
  const docs = tracked.docs;
  const rows: Row[] = [];
  const years = [2025, 2026];

  const CHUNK = 25;
  for (let i = 0; i < docs.length; i += CHUNK) {
    await Promise.all(
      docs.slice(i, i + CHUNK).map(async (d) => {
        const symbol = d.id;
        const t = d.data() || {};

        const [ov, ...yearSnaps] = await Promise.all([
          db.doc(`symbol-data/${symbol}/company-overview/av-company-overview`).get(),
          ...years.map((y) =>
            db.doc(`symbol-data/${symbol}/sa-time-series/av-daily-adjusted/years/${y}`).get()
          ),
        ]);

        const ovData = ov.exists ? ov.data()?.data : undefined;
        const mcRaw = ovData?.MarketCapitalization;
        const mc = Number(mcRaw);
        const betaRaw = ovData?.Beta;
        const beta = betaRaw !== undefined && betaRaw !== null ? Number(betaRaw) : null;

        // Merge year docs, sort ascending by bar timestamp, dedupe
        const barMap = new Map<number, number>();
        for (const snap of yearSnaps) {
          const bars = (snap.exists ? snap.data()?.bars : undefined) ?? [];
          for (const b of bars) {
            const ts = Number(b?.t);
            const close = Number(b?.c);
            if (Number.isFinite(ts) && Number.isFinite(close) && close > 0) {
              barMap.set(ts, close);
            }
          }
        }
        const closes = [...barMap.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);

        const rets: number[] = [];
        for (let j = 1; j < closes.length; j++) {
          const r = Math.log(closes[j] / closes[j - 1]);
          if (Number.isFinite(r)) rets.push(r);
        }

        rows.push({
          symbol,
          name: t.companyInfo?.Name || ovData?.Name || t.name || '',
          sector: t.companyInfo?.Sector || ovData?.Sector || '',
          marketCap: mcRaw !== undefined && !Number.isNaN(mc) && mc > 0 ? mc : null,
          beta: beta !== null && !Number.isNaN(beta) ? beta : null,
          vol60d: annualizedVol(rets.slice(-60)),
          vol1y: annualizedVol(rets.slice(-252)),
          bars: closes.length,
        });
      })
    );
    process.stdout.write(`\rprocessed ${Math.min(i + CHUNK, docs.length)}/${docs.length}`);
  }
  process.stdout.write('\n');

  const withCap = rows.filter((r) => r.marketCap != null).sort((a, b) => b.marketCap! - a.marketCap!);
  const withVol = rows.filter((r) => r.vol60d != null);
  const noOverview = rows.filter((r) => r.marketCap == null).map((r) => r.symbol);
  const noBars = rows.filter((r) => r.bars === 0).map((r) => r.symbol);
  const noBeta = rows.filter((r) => r.beta == null && r.marketCap != null).map((r) => r.symbol);

  console.log(`\nTracked: ${docs.length} | market cap: ${withCap.length} | realized vol computable: ${withVol.length}`);
  console.log(`missing overview: ${noOverview.length} | no daily bars: ${noBars.length} | overview but no Beta: ${noBeta.length}\n`);

  console.log('TOP 30 BY MARKET CAP (with Beta + realized vol)');
  withCap.slice(0, 30).forEach((r, i) => {
    console.log(
      `${String(i + 1).padStart(3)}. ${r.symbol.padEnd(6)} ${fmtCap(r.marketCap!).padStart(9)}` +
      `  beta ${String(r.beta ?? '-').padEnd(6)} vol60d ${fmtPct(r.vol60d).padStart(6)} vol1y ${fmtPct(r.vol1y).padStart(6)}` +
      `  ${(r.sector || '-').padEnd(20)} ${r.name}`
    );
  });

  console.log('\nTOP 20 BY 60D REALIZED VOL (min $1B market cap)');
  withVol
    .filter((r) => (r.marketCap ?? 0) >= 1e9)
    .sort((a, b) => b.vol60d! - a.vol60d!)
    .slice(0, 20)
    .forEach((r, i) => {
      console.log(
        `${String(i + 1).padStart(3)}. ${r.symbol.padEnd(6)} vol60d ${fmtPct(r.vol60d).padStart(6)} vol1y ${fmtPct(r.vol1y).padStart(6)}` +
        `  beta ${String(r.beta ?? '-').padEnd(6)} ${fmtCap(r.marketCap ?? 0).padStart(9)}  ${r.name}`
      );
    });

  console.log('\n--- full list (csv) ---');
  console.log('symbol,market_cap_usd,beta,vol_60d,vol_1y,bars,sector,name');
  [...rows]
    .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))
    .forEach((r) =>
      console.log(
        `${r.symbol},${r.marketCap ?? ''},${r.beta ?? ''},${r.vol60d?.toFixed(4) ?? ''},${r.vol1y?.toFixed(4) ?? ''},${r.bars},"${r.sector}","${String(r.name).replace(/"/g, '""')}"`
      )
    );

  if (noBars.length) console.log(`\nNo daily bars (${noBars.length}): ${noBars.join(', ')}`);
  if (noBeta.length) console.log(`\nOverview present but no Beta (${noBeta.length}): ${noBeta.join(', ')}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('fatal', (e && e.message) || e);
  process.exit(1);
});

/*
  Dev Refresh Loop (Emulator Only)
  - Triggers PRE (intraday snapshot) exactly once per ET market day
  - Uses the Daily handler PRE branch, which fetches Intraday (1min) internally and writes the snapshot
  - Reads symbols once at start from tracked_symbols (no dynamic updates)

  Usage (bash):
    # In functions/ directory
    export LOG_LEVEL=info
    export HUMAN_LOGS=true
    export LOCAL_EMULATOR_ALPHAVANTAGE_API_KEY="YOUR_KEY"
    npm run dev:refresh-loop

  Notes:
    - Requires emulators running (Firestore)
    - PRE is executed only once per ET date during 14:30–15:30 ET (2:30–3:30pm ET)
*/

import { db } from '../src/firebase-admin-init';
import { AlphaVantageHandlerFactory } from '../src/v2/alpha-vantage/alpha-vantage-factory';
import { createLogger } from '../src/v2/utils/utils';
import { FirestoreCollection } from '@shared/firestore';
import { AlphaVantageEndpoint } from '@shared/alpha-vantage';

const log = createLogger('dev.refresh.loop');

// ET time helpers
function nowEt(): Date { return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })); }
function isEtWeekend(d: Date): boolean { const g = d.getDay(); return g === 0 || g === 6; }
function etHhMm(d: Date): { hh: number; mm: number } { return { hh: d.getHours(), mm: d.getMinutes() }; }
function isPreWindowEt(d: Date): boolean {
  if (isEtWeekend(d)) return false;
  const { hh, mm } = etHhMm(d);
  const mins = hh * 60 + mm;
  // 14:30 <= now < 15:30 ET (2:30pm–3:30pm ET)
  return mins >= (14 * 60 + 30) && mins < (15 * 60 + 30);
}

async function readTrackedSymbols(): Promise<string[]> {
  const snap = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
  return snap.docs.map(d => d.id).filter(Boolean);
}

async function runPre(symbols: string[]) {
  const endpoint = AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED;
  const handler = AlphaVantageHandlerFactory.createHandler(endpoint);
  log.info('pre.start', { count: symbols.length });
  for (const symbol of symbols) {
    try {
      // PRE branch (internally fetches Intraday 1min and writes snapshot ip/io/it)
      await handler.fetch({ symbol, outputsize: 'compact', __checkWriteToggle: false, __phase: 'pre' });
      log.info('pre.ok', { symbol });
    } catch (e: any) {
      log.warn('pre.err', { symbol, error: String(e?.message || e) });
    }
  }
  log.info('pre.done', {});
}

async function main() {
  if (process.env.FUNCTIONS_EMULATOR !== 'true' && !process.env.FIRESTORE_EMULATOR_HOST) {
    log.warn('env.warn', { message: 'This script is intended for emulator use. FIRESTORE_EMULATOR_HOST not set.' });
  }
  const intervalMs = Number(process.env.DEV_LOOP_INTERVAL_MS || 180000); // 3 min default
  let lastPreDateEt = '';

  // Load symbols once at start
  const symbols = await readTrackedSymbols();
  if (symbols.length === 0) {
    log.warn('symbols.empty', { message: 'No tracked symbols found. Add to tracked_symbols and restart.' });
  }

  log.info('loop.start', { intervalMs, symbolsCount: symbols.length });

  // Main loop: PRE exactly once per ET date
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const et = nowEt();
    const etDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(et); // YYYY-MM-DD

    try {
      if (isPreWindowEt(et) && lastPreDateEt !== etDateStr) {
        await runPre(symbols);
        lastPreDateEt = etDateStr;
        log.info('pre.mark', { lastPreDateEt });
      } else {
        log.debug('idle', { et: et.toISOString(), lastPreDateEt, etDateStr });
      }
    } catch (e: any) {
      log.error('loop.error', { error: String(e?.message || e) });
    }

    await new Promise(r => setTimeout(r, intervalMs));
  }
}

// Kickoff
main().catch(err => {
  log.error('fatal', { error: String(err?.message || err) });
  process.exit(1);
});

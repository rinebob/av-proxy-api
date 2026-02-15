#!/usr/bin/env node
import 'module-alias/register';
/**
 * partner-data-ready-direct.ts
 *
 * Direct publisher (no HTTP). Invokes enqueueDataReadyInternal(...) to publish a
 * DataReadyPayloadV1 to the partner-data-ready Pub/Sub topic.
 *
 * Usage examples:
 *   # Autofill (derive ET phase/date, intervals=daily)
 *   npx ts-node functions/scripts/partner/partner-data-ready-direct.ts --autofill --env dev --verbose
 *
 *   # Custom payload from file
 *   npx ts-node functions/scripts/partner-data-ready-direct.ts --body payload.json --verbose
 *
 * Notes:
 * - Requires Google Application Default Credentials for Pub/Sub/Firestore, or emulator env vars
 *   (PUBSUB_EMULATOR_HOST, FIRESTORE_EMULATOR_HOST). See Firebase emulator docs.
 */

/* eslint-disable no-console */

import process from 'node:process';
import { validateDataReadyPayload, type DataReadyPayloadV1 } from '../../src/v2/partner/schemas/data-ready.schema';
import { enqueueDataReadyInternal } from '../../src/v2/partner/data-ready.handler';
import { INTERNAL_PUBLISHER_AUDIT_EMAIL, PartnerPhase, PartnerTrigger } from '../../src/v2/partner/constants';
import { TimeSeriesInterval } from '@shared/alpha-vantage';

// Ensure local env file is loaded when executing from repo root or functions dir (optional best-effort)
(() => {
  try {
    if (process.env['FUNCTIONS_EMULATOR'] === 'true') {
      // Align with index.ts behavior
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('dotenv').config({ path: './functions/local-dev.env.alpha-vantage-proxy-api' });
    }
  } catch {}
})();

interface Args {
  autofill: boolean;
  env?: string;
  intervals?: string; // comma-separated
  bodyPath?: string; // JSON file path
  attributes?: string; // k=v,k2=v2 list to attach as Pub/Sub message attributes
  phase?: PartnerPhase;
  trigger?: PartnerTrigger;
  verbose: boolean;
  // Optional explicit market date override (YYYY-MM-DD, ET trading date)
  marketDate?: string;
  // Live realtime run simulation options
  sequence?: 'A' | 'B' | 'C'; // A=initial, B=intermediate, C=final
  live?: boolean; // Enable live realtime run mode
  includeSymbols?: string; // Comma-separated list of symbols to include
  excludeSymbols?: string; // Comma-separated list of symbols to exclude
  duration?: number; // Duration in seconds for the run
  finalizedCount?: number; // Number of finalized symbols
}

function getEnv(name: string, fallback?: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback ?? '';
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const out: Args = {
    autofill: false,
    env: getEnv('ENV'),
    intervals: getEnv('INTERVALS'),
    bodyPath: getEnv('BODY'),
    attributes: getEnv('ATTRS') || getEnv('ATTRIBUTES'),
    phase: undefined,
    trigger: undefined,
    verbose: false, // Default to false, will be set by --verbose
    marketDate: undefined,
    sequence: undefined,
    live: false, // Default to false, will be set by --live
    includeSymbols: undefined, // Will be set by --include-symbols
    excludeSymbols: undefined, // Will be set by --exclude-symbols
    duration: undefined, // Will be set by --duration
    finalizedCount: undefined, // Will be set by --finalized-count
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const n = argv[i + 1];
    switch (a) {
      case '--autofill': out.autofill = true; break;
      case '--env': out.env = n; i++; break;
      case '--intervals': out.intervals = n; i++; break;
      case '--body': out.bodyPath = n; i++; break;
      case '--attributes': out.attributes = n; i++; break;
      case '--market-date': out.marketDate = n; i++; break;
      case '--trigger':
        if (n !== 'manual' && n !== 'scheduled' && n !== 'heartbeat' && n !== 'test') {
          console.error('--trigger must be one of "manual", "scheduled", "heartbeat", or "test"');
          process.exit(2);
        }
        out.trigger = n as PartnerTrigger;
        i++;
        break;
      case '--phase':
        if (n !== 'pre' && n !== 'post') {
          console.error('--phase must be "pre" or "post"');
          process.exit(2);
        }
        out.phase = n as PartnerPhase;
        i++;
        break;
      case '--verbose': out.verbose = true; break;
      case '--sequence':
        if (n !== 'A' && n !== 'B' && n !== 'C') {
          console.error('--sequence must be one of "A", "B", or "C"');
          process.exit(2);
        }
        out.sequence = n as 'A' | 'B' | 'C';
        i++;
        break;
      case '--live': out.live = true; break;
      case '--include-symbols': out.includeSymbols = n; i++; break;
      case '--exclude-symbols': out.excludeSymbols = n; i++; break;
      case '--duration': out.duration = Number(n); i++; break;
      case '--finalized-count': out.finalizedCount = Number(n); i++; break;
      case '-h':
      case '--help':
        printHelpAndExit();
        break;
      default:
        if (a.startsWith('-')) {
          console.error(`Unknown arg: ${a}`);
          printHelpAndExit(2);
        }
    }
  }
  if (!out.autofill && !out.bodyPath) {
    console.error('Provide either --autofill or --body path to JSON.');
    printHelpAndExit(2);
  }
  return out;
}

function printHelpAndExit(code = 0) {
  console.log(`Usage: npx ts-node functions/scripts/partner/partner-data-ready-direct.ts [options]

Options / Env:
  --autofill                Generate minimal payload server-side (derive ET phase/date)
  --env NAME                env field when using --autofill (e.g., dev|staging|prod)
  --intervals LIST          comma-separated intervals for --autofill (daily,weekly,monthly)
  --market-date YYYY-MM-DD  override derived ET marketDate (e.g., historical 2026-02-13)
  --phase pre|post          override auto phase detection for --autofill
  --trigger VALUE           override trigger (manual|scheduled|heartbeat|test) for both modes
  --body PATH               path to JSON with full DataReadyPayloadV1
  --attributes LIST         message attributes as k=v,k2=v2 (added alongside runId/version/phase)
  --verbose                 verbose output
  
  Live Realtime Run Simulation:
  --sequence A|B|C          Message sequence (A=initial, B=intermediate, C=final)
  --live                    Enable live realtime run mode
  --include-symbols LIST    Comma-separated symbols to include
  --exclude-symbols LIST    Comma-separated symbols to exclude
  --duration SECONDS        Duration in seconds for the run
  --finalized-count NUM     Number of finalized symbols
  
  -h, --help                show help

Env overrides:
  ENV, INTERVALS, BODY, ATTRS|ATTRIBUTES, VERBOSE, LIVE, INCLUDE_SYMBOLS, EXCLUDE_SYMBOLS, DURATION, FINALIZED_COUNT
`);
  process.exit(code);
}

function derivePhaseAndMarketDate(): { phase: PartnerPhase; marketDate: string } {
  const tz = 'America/New_York';
  const now = new Date();
  const marketDate = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false }).format(now));
  const phase: PartnerPhase = hour >= 16 ? PartnerPhase.POST : PartnerPhase.PRE;
  return { phase, marketDate };
}

function deriveDowFromMarketDate(marketDate: string): string {
  // marketDate is YYYY-MM-DD in ET; interpret it as midnight ET
  const [y, m, d] = marketDate.split('-').map((s) => Number(s));
  if (!y || !m || !d) return 'UNK';
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)); // noon UTC ensures same date in ET
  const dayIdx = dt.getDay();
  const map = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  return map[dayIdx] ?? 'UNK';
}

function parseAttributes(list?: string): Record<string, string> | undefined {
  if (!list) return undefined;
  const attrs: Record<string, string> = {};
  for (const part of list.split(',').map((s) => s.trim()).filter(Boolean)) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) attrs[k] = v;
  }
  return Object.keys(attrs).length > 0 ? attrs : undefined;
}

function formatPacific(ms: number): string {
  const opts: Intl.DateTimeFormatOptions = {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, timeZone: 'America/Los_Angeles'
  };
  return new Intl.DateTimeFormat('en-CA', opts).format(new Date(ms)) + ' PT';
}

function genHhmmET(): string {
  const tz = 'America/New_York';
  const now = new Date();
  const hh = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false }).format(now).padStart(2, '0');
  const mm = new Intl.DateTimeFormat('en-US', { timeZone: tz, minute: '2-digit' }).format(now).padStart(2, '0');
  return `${hh}${mm}`; // hhmm
}

async function main(): Promise<void> {
  const args = parseArgs();

  let payload: DataReadyPayloadV1;

  if (args.autofill) {
    const { phase: autoPhase, marketDate: derivedMarketDate } = derivePhaseAndMarketDate();
    const intervals: TimeSeriesInterval[] = args.intervals
      ? args.intervals.split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.toLowerCase() as any)
      : [TimeSeriesInterval.DAILY];

    const isManualTrigger = args.trigger === PartnerTrigger.MANUAL;
    const phase: PartnerPhase = isManualTrigger
      ? PartnerPhase.POST
      : ((args.phase as PartnerPhase) ?? autoPhase);
    const hhmm = genHhmmET();

    // Allow explicit historical marketDate override for RS-style tests
    const effectiveMarketDate = args.marketDate || derivedMarketDate;

    let runId: string;
    if (isManualTrigger) {
      // Manual partner-data-ready messages are always sent one interval at a time.
      // Use uppercased INTERVAL, PHASE, and MANUAL segments in the runId and
      // place the HHMM segment immediately after the date so the final format is:
      //   YYYY-MM-DD-HHMM-INTERVAL-PHASE-MANUAL
      // Example: 2026-02-07-1546-WEEKLY-POST-MANUAL
      const phaseSegment = String(phase).toUpperCase();
      const intervalSegment = String(intervals[0] ?? TimeSeriesInterval.DAILY).toUpperCase();
      const triggerSegment = String(PartnerTrigger.MANUAL).toUpperCase();
      runId = `${effectiveMarketDate}-${hhmm}-${intervalSegment}-${phaseSegment}-${triggerSegment}`;
    } else {
      // Canonical A/B/C realtime format:
      // YYYY-MM-DD-DOW-SEQ-INTERVAL-LIVE|MANUAL-PHASE-HHMM
      const seq = args.sequence ?? 'A';
      const intervalSegment = String(intervals[0] ?? TimeSeriesInterval.DAILY).toUpperCase();
      const liveOrManual = isManualTrigger ? 'MANUAL' : 'LIVE';
      const phaseSegment = String(phase).toUpperCase();
      const dowStr = deriveDowFromMarketDate(effectiveMarketDate);
      runId = `${effectiveMarketDate}-${dowStr}-${seq}-${intervalSegment}-${liveOrManual}-${phaseSegment}-${hhmm}`;
    }

    payload = {
      version: 'v1',
      runId,
      phase,
      intervals,
      time: Date.now(),
      marketDate: effectiveMarketDate,
      env: args.env ?? (process.env['NODE_ENV'] || 'dev'),
      trigger: args.trigger ?? PartnerTrigger.TEST,
    } as DataReadyPayloadV1;

    // Add live realtime run simulation fields if specified
    if (args.sequence) {
      (payload as any).sequence = args.sequence;
    }
    if (args.live !== undefined) {
      (payload as any).live = args.live;
    }
    if (args.includeSymbols) {
      (payload as any).includeSymbols = args.includeSymbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    }
    if (args.excludeSymbols) {
      (payload as any).excludeSymbols = args.excludeSymbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    }
    if (args.duration !== undefined) {
      (payload as any).duration = args.duration;
    }
    if (args.finalizedCount !== undefined) {
      (payload as any).finalizedCount = args.finalizedCount;
    }
  } else {
    const fs = await import('node:fs/promises');
    const raw = await fs.readFile(args.bodyPath!, 'utf8');
    payload = JSON.parse(raw);
    // Optional override: allow caller to force a specific trigger (including TEST)
    // without requiring the JSON body to be edited.
    if (args.trigger) {
      (payload as any).trigger = args.trigger;
    }
  }

  const { ok, errors, value } = validateDataReadyPayload(payload);
  if (!ok || !value) {
    console.error('Invalid payload', errors);
    process.exit(2);
  }

  const extraAttributes = parseAttributes(args.attributes) || {};

  const publishStartedAt = Date.now();
  const callerEmail = INTERNAL_PUBLISHER_AUDIT_EMAIL;

  // Derive runType attribute for A/B/C POST runs so RS can distinguish
  // initial vs retry passes, matching the realtime-run-aggregator behavior:
  // - ts-post-all-intervals-initial: primary close run (sequence A, full universe).
  // - ts-post-all-intervals-retry: retry-only passes (B / C).
  const attributes = { ...extraAttributes };
  if (args.sequence === 'A') {
    attributes.runType = 'ts-post-all-intervals-initial';
  } else if (args.sequence === 'B' || args.sequence === 'C') {
    attributes.runType = 'ts-post-all-intervals-retry';
  }

  const result = await enqueueDataReadyInternal(value, callerEmail, attributes);
  const publishedAtPacific = formatPacific(publishStartedAt);

  // Build previewAttributes from final attributes set so verbose output matches
  const previewAttributes: Record<string, string> = {
    runId: value.runId,
    version: value.version,
    phase: value.phase,
  };
  if (value.marketDate) previewAttributes['marketDate'] = value.marketDate;
  if (value.env) previewAttributes['env'] = value.env as string;
  for (const [k, v] of Object.entries(attributes)) {
    if (v != null) previewAttributes[k] = String(v);
  }

  if (args.verbose) {
    console.log(JSON.stringify({ ...result, ok: true, runId: value.runId, publishedAtPacific, payload: value, attributes: previewAttributes }, null, 2));
  } else {
    console.log(`ok requestId=${result.requestId} status=${result.status} messageId=${result.messageId ?? ''} runId=${value.runId} pacific=${publishedAtPacific}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

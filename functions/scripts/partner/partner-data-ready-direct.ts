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
    verbose: getEnv('VERBOSE', '0') === '1',
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
  --phase pre|post          override auto phase detection for --autofill
  --trigger VALUE           override trigger (manual|scheduled|heartbeat|test) for both modes
  --body PATH               path to JSON with full DataReadyPayloadV1
  --attributes LIST         message attributes as k=v,k2=v2 (added alongside runId/version/phase)
  --verbose                 verbose output
  -h, --help                show help

Env overrides:
  ENV, INTERVALS, BODY, ATTRS|ATTRIBUTES, VERBOSE
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

async function main() {
  const args = parseArgs();

  let payload: DataReadyPayloadV1;

  if (args.autofill) {
    const { phase: autoPhase, marketDate } = derivePhaseAndMarketDate();
    const intervals: TimeSeriesInterval[] = args.intervals
      ? args.intervals.split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.toLowerCase() as any)
      : [TimeSeriesInterval.DAILY];

    const isManualTrigger = args.trigger === PartnerTrigger.MANUAL;
    const phase: PartnerPhase = isManualTrigger
      ? PartnerPhase.POST
      : ((args.phase as PartnerPhase) ?? autoPhase);
    const hhmm = genHhmmET();

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
      runId = `${marketDate}-${hhmm}-${intervalSegment}-${phaseSegment}-${triggerSegment}`;
    } else {
      runId = `${marketDate}-${hhmm}-${phase}`; // yyyy-mm-dd-hhmm-phase
    }

    payload = {
      version: 'v1',
      runId,
      phase,
      intervals,
      time: Date.now(),
      marketDate,
      env: args.env ?? (process.env['NODE_ENV'] || 'dev'),
      trigger: args.trigger ?? PartnerTrigger.TEST,
    } as DataReadyPayloadV1;
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

  // Compute attributes preview to mirror handler behavior (for console visibility)
  const previewAttributes: Record<string, string> = {
    runId: value.runId,
    version: value.version,
    phase: value.phase,
  };
  if (value.marketDate) previewAttributes['marketDate'] = value.marketDate;
  if (value.env) previewAttributes['env'] = value.env as string;
  for (const [k, v] of Object.entries(extraAttributes)) {
    if (v != null) previewAttributes[k] = String(v);
  }

  const publishStartedAt = Date.now();
  const callerEmail = INTERNAL_PUBLISHER_AUDIT_EMAIL;
  const res = await enqueueDataReadyInternal(value, callerEmail, extraAttributes);
  const publishedAtPacific = formatPacific(publishStartedAt);

  if (args.verbose) {
    console.log(JSON.stringify({ ...res, ok: true, runId: value.runId, publishedAtPacific, payload: value, attributes: previewAttributes }, null, 2));
  } else {
    console.log(`ok requestId=${res.requestId} status=${res.status} messageId=${res.messageId ?? ''} runId=${value.runId} pacific=${publishedAtPacific}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

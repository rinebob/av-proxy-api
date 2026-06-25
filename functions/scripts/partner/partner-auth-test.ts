#!/usr/bin/env node
/**
 * partner-auth-test.ts
 *
 * TypeScript smoke test for partner endpoints (Gen2 Cloud Functions).
 * - Mints per-function Google OIDC ID tokens via `gcloud auth print-identity-token` (service account impersonation).
 * - Calls partnerListTrackedSymbolsV2 and partnerTimeSeriesV2 with Authorization header.
 * - Designed to be run via ts-node, or compiled (scripts/tsconfig.json) then run with node.
 */

/* eslint-disable no-console */

import { spawn } from 'node:child_process';
import process from 'node:process';

// Simple arg parsing
interface Args {
  sa: string; // required
  project: string;
  region: string;
  fnList: string;
  fnTs: string;
  fnOverview: string;
  symbol: string;
  interval: 'daily' | 'weekly' | 'monthly';
  limit: number;
  activeOnly: 'true' | 'false';
  verbose: boolean;
  checkTokeninfo: boolean;
}

function getEnv(name: string, fallback?: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback ?? '';
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const out: Args = {
    sa: getEnv('SA'),
    project: getEnv('PROJECT', 'alpha-vantage-proxy-api'),
    region: getEnv('REGION', 'us-central1'),
    fnList: getEnv('FN_LIST', 'partnerListTrackedSymbolsV2'),
    fnTs: getEnv('FN_TS', 'partnerTimeSeriesV2'),
    fnOverview: getEnv('FN_OVERVIEW', 'partnerCompanyOverviewV2'),
    symbol: getEnv('SYMBOL', 'AAPL'),
    interval: (getEnv('INTERVAL', 'daily') as Args['interval']),
    limit: Number(getEnv('LIMIT', '500')),
    activeOnly: (getEnv('ACTIVE_ONLY', 'true') as Args['activeOnly']),
    verbose: getEnv('VERBOSE', '0') === '1',
    checkTokeninfo: getEnv('CHECK_TOKENINFO', '0') === '1',
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const n = argv[i + 1];
    switch (a) {
      case '--sa': out.sa = n; i++; break;
      case '--project': out.project = n; i++; break;
      case '--region': out.region = n; i++; break;
      case '--symbol': out.symbol = n; i++; break;
      case '--interval': out.interval = n as Args['interval']; i++; break;
      case '--limit': out.limit = Number(n); i++; break;
      case '--activeOnly': out.activeOnly = n as Args['activeOnly']; i++; break;
      case '--fn-overview': out.fnOverview = n; i++; break;
      case '--verbose': out.verbose = true; break;
      case '--check-tokeninfo': out.checkTokeninfo = true; break;
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
  if (!out.sa) {
    console.error('Missing SA. Pass --sa EMAIL or set SA env.');
    printHelpAndExit(2);
  }
  return out;
}

function printHelpAndExit(code = 0) {
  const project = getEnv('PROJECT', 'alpha-vantage-proxy-api');
  const region = getEnv('REGION', 'us-central1');
  console.log(`Usage: PROJECT=... REGION=... SA=... ts-node partner-auth-test.ts [options]

Options / Env:
  --sa EMAIL              Service account to impersonate (or set SA env)
  --project ID            GCP project (default: ${project})
  --region NAME           Region (default: ${region})
  --symbol TICKER         Symbol for time series (default: AAPL)
  --interval daily|weekly|monthly  Time series interval (default: daily)
  --limit N               Limit tracked symbols (default: 500)
  --activeOnly true|false Filter tracked symbols (default: true)
  --fn-overview NAME      Override company-overview function name (default: partnerCompanyOverviewV2)
  --verbose               Verbose HTTP output
  --check-tokeninfo       Call tokeninfo for minted tokens (jq-free)
  -h, --help              Show this help

Env overrides:
  PROJECT, REGION, SA, FN_LIST, FN_TS, FN_OVERVIEW, HOST, URL_LIST, URL_TS,
  SYMBOL, INTERVAL, LIMIT, ACTIVE_ONLY, VERBOSE, CHECK_TOKENINFO
`);
  process.exit(code);
}

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

function buildUrls(project: string, region: string, fnList: string, fnTs: string, fnOverview: string) {
  const host = `https://${region}-${project}.cloudfunctions.net`;
  const urlList = `${host}/${fnList}`;
  const urlTs = `${host}/${fnTs}`;
  const urlOverview = `${host}/${fnOverview}`;
  return { host, urlList, urlTs, urlOverview };
}

function quoteArg(a: string): string {
  // Minimal quoting safe for cmd.exe; caller should not pre-quote env values
  return /\s/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a;
}

function normalizeGcloudPath(p: string): string {
  // Convert MSYS/Git Bash style like /c/Program Files/... to Windows C:\Program Files\...
  // Only applies on Windows hosts; otherwise return as-is.
  if (process.platform !== 'win32') return p;
  const m = p.match(/^\/([a-zA-Z])\/(.*)$/);
  if (!m) return p;
  const drive = m[1].toUpperCase();
  const rest = m[2].replace(/\//g, '\\');
  return `${drive}:\\${rest}`;
}

function spawnCapture(cmd: string, args: string[], useShell = false): Promise<{ stdout: string; stderr: string; code: number }>{
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = useShell
      ? spawn(`${quoteArg(cmd)} ${args.map(quoteArg).join(' ')}`, { stdio: ['ignore', 'pipe', 'pipe'], shell: true })
      : spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => stdout += d.toString());
    child.stderr.on('data', (d) => stderr += d.toString());
    child.on('error', (err) => {
      // Surface spawn errors (e.g., ENOENT, EINVAL)
      stderr += err?.message || String(err);
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: 1 });
    });
    child.on('close', (code) => resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: code ?? 0 }));
  });
}

async function mintToken(sa: string, audience: string): Promise<string> {
  // Resolve gcloud executable; allow GCLOUD override. Do not include quotes in GCLOUD.
  const gcloudRaw = process.env.GCLOUD && process.env.GCLOUD.trim().length > 0
    ? process.env.GCLOUD
    : (process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud');
  const gcloud = normalizeGcloudPath(gcloudRaw);
  const args = [
    'auth', 'print-identity-token',
    `--audiences=${audience}`,
    `--impersonate-service-account=${sa}`,
    '--include-email',
  ];

  // On Windows, .cmd files require shell:true — direct spawn always raises EINVAL.
  // On other platforms, try direct spawn first for cleaner arg passing.
  const useShell = process.platform === 'win32';
  const result = await spawnCapture(gcloud, args, useShell);

  if (result.code !== 0) {
    const hint = `If on Windows, ensure Google Cloud CLI is on PATH or set GCLOUD to the full path (no surrounding quotes).\nExamples:\n  Git Bash:   export GCLOUD=/c/Program\ Files/Google/Cloud\ SDK/google-cloud-sdk/bin/gcloud.cmd\n  PowerShell: $env:GCLOUD=\"C:\\Program Files\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd\"`;
    throw new Error(`gcloud failed (${result.code}) using '${gcloud}': ${result.stderr || result.stdout}\n${hint}`);
  }
  return result.stdout;
}

async function httpGet(url: string, token: string, verbose: boolean) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (verbose) {
    console.log(`HTTP ${res.status} ${res.statusText} -> ${url}`);
    const text = await res.text();
    console.log(text);
  } else {
    console.log(`${res.status} ${url}`);
  }
}

async function tokenInfo(token: string) {
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
  const text = await res.text();
  console.log(text);
}

async function main() {
  const args = parseArgs();
  const { urlList, urlTs, urlOverview } = buildUrls(args.project, args.region, args.fnList, args.fnTs, args.fnOverview);

  log(`Project: ${args.project} | Region: ${args.region}`);
  log(`SA: ${args.sa}`);
  log(`List URL: ${urlList}`);
  log(`TimeSeries URL: ${urlTs}`);
  log(`Overview URL: ${urlOverview}`);

  log(`Minting token for LIST (aud=${urlList})`);
  const tokenList = await mintToken(args.sa, urlList);

  log(`Minting token for TIME-SERIES (aud=${urlTs})`);
  const tokenTs = await mintToken(args.sa, urlTs);

  log(`Minting token for OVERVIEW (aud=${urlOverview})`);
  const tokenOverview = await mintToken(args.sa, urlOverview);

  if (args.checkTokeninfo) {
    log('tokeninfo for TOKEN_LIST (jq-free)');
    await tokenInfo(tokenList);
    log('tokeninfo for TOKEN_TS (jq-free)');
    await tokenInfo(tokenTs);
    log('tokeninfo for TOKEN_OVERVIEW (jq-free)');
    await tokenInfo(tokenOverview);
  }

  log(`Calling LIST (activeOnly=${args.activeOnly}, limit=${args.limit})`);
  await httpGet(`${urlList}?activeOnly=${args.activeOnly}&limit=${args.limit}`, tokenList, args.verbose);

  log(`Calling TIME-SERIES (symbol=${args.symbol}, interval=${args.interval})`);
  await httpGet(`${urlTs}?symbol=${encodeURIComponent(args.symbol)}&interval=${args.interval}`, tokenTs, args.verbose);

  log(`Calling OVERVIEW (symbol=${args.symbol})`);
  await httpGet(`${urlOverview}?symbol=${encodeURIComponent(args.symbol)}`, tokenOverview, args.verbose);

  log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

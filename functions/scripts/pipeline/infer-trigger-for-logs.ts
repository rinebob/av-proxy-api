/**
 * Infer triggers for historical request logs and write metadata.trigger
 * for rows missing it. Preserves existing values.
 *
 * Usage (from functions/):
 *   npx ts-node -r tsconfig-paths/register ./pipeline/infer-trigger-for-logs.ts \
 *     --from=2024-01-01 --to=2025-10-01 --limit=1000 --offset=0 --dryRun=1 \
 *     --endpoint=TIME_SERIES_DAILY_ADJUSTED --symbol=AAPL
 *
 * Notes:
 * - Never overwrites existing metadata.trigger
 * - Writes a value including ' (inferred)' suffix when inferring
 */

/* eslint-disable no-console */

import { db } from '../../src/firebase-admin-init';
import { FirestoreCollection } from '@shared/firestore';
import {
  AV_REFRESH_MANAGER_SCHEDULE,
  TS_DAILY_PRE_CLOSE_SCHEDULE,
  TS_DAILY_POST_CLOSE_SCHEDULE,
  DAILY_TIME_SERIES_UPDATE_SCHEDULE,
} from '../../src/v2/common/function-schedules';

// ------------------------- CLI args -------------------------
function getArg(name: string, def?: string): string | undefined {
  const prefix = `--${name}=`;
  const raw = process.argv.find((a) => a.startsWith(prefix));
  if (!raw) return def;
  return raw.slice(prefix.length);
}

function parseDateISO(v?: string): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : d;
}

function parseBool(v?: string): boolean | undefined {
  if (v == null) return undefined;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(s)) return true;
  if (['0', 'false', 'no', 'n'].includes(s)) return false;
  return undefined;
}

// Parse Firestore Timestamp | Date | number | string into Date
function toJsDate(val: any): Date | undefined {
  if (!val) return undefined;
  try {
    if (typeof val?.toDate === 'function') return val.toDate(); // Firestore Timestamp
    if (val instanceof Date) return val;
    if (typeof val === 'number') {
      // Heuristic: 10 digits seconds, 13 digits ms
      const n = Number(val);
      if (!Number.isFinite(n)) return undefined;
      const ms = Math.abs(n) < 1e11 ? n * 1000 : n;
      const d = new Date(ms);
      return isNaN(d.getTime()) ? undefined : d;
    }
    if (typeof val === 'string') {
      const num = Number(val);
      if (Number.isFinite(num)) {
        return toJsDate(num);
      }
      const d = new Date(val);
      return isNaN(d.getTime()) ? undefined : d;
    }
    if (typeof val === 'object') {
      // Serialized Timestamp { seconds, nanoseconds } or {_seconds, _nanoseconds}
      const secs = typeof val.seconds === 'number' ? val.seconds : (typeof val._seconds === 'number' ? val._seconds : undefined);
      if (typeof secs === 'number') {
        const d = new Date(Math.floor(secs * 1000));
        return isNaN(d.getTime()) ? undefined : d;
      }
    }
  } catch {}
  return undefined;
}

// ------------------------- Time helpers -------------------------
function cronMinutesOfDay(cron: string): number | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const [minStr, hrStr] = parts;
  const m = Number(minStr);
  const h = Number(hrStr);
  if (!Number.isFinite(m) || !Number.isFinite(h)) return null;
  return h * 60 + m;
}

function minutesOfDayUTC(d: Date): number {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

// Given a cron minutes-of-day in ET, produce candidate UTC minutes-of-day for both EDT (UTC-4) and EST (UTC-5).
// This avoids needing full timezone/DST logic while still catching scheduler windows year-round.
function etMinutesToUtcCandidates(etMinutes: number): number[] {
  // EDT: UTC = ET + 4h
  const edt = (etMinutes + 4 * 60) % (24 * 60);
  // EST: UTC = ET + 5h
  const est = (etMinutes + 5 * 60) % (24 * 60);
  return [edt < 0 ? edt + 24 * 60 : edt, est < 0 ? est + 24 * 60 : est];
}

type AvSchedule = { name: string; cron: string };
const AV_SCHEDULES: AvSchedule[] = [
  { name: 'AV_REFRESH_MANAGER_SCHEDULE', cron: AV_REFRESH_MANAGER_SCHEDULE },
  { name: 'TS_DAILY_PRE_CLOSE_SCHEDULE', cron: TS_DAILY_PRE_CLOSE_SCHEDULE },
  { name: 'TS_DAILY_POST_CLOSE_SCHEDULE', cron: TS_DAILY_POST_CLOSE_SCHEDULE },
  { name: 'DAILY_TIME_SERIES_UPDATE_SCHEDULE', cron: DAILY_TIME_SERIES_UPDATE_SCHEDULE },
];

function nearestAvScheduleDeltaMinutes(tsUtc: Date, windowMin: number): { name: string; delta: number } | null {
  const mod = minutesOfDayUTC(tsUtc);
  let best: { name: string; delta: number } | null = null;
  for (const s of AV_SCHEDULES) {
    const et = cronMinutesOfDay(s.cron);
    if (et == null) continue;
    for (const c of etMinutesToUtcCandidates(et)) {
      const abs = Math.abs(mod - c);
      const circ = Math.min(abs, 24 * 60 - abs);
      const d = circ;
      if (best == null || d < best.delta) {
        best = { name: s.name, delta: d };
      }
    }
  }
  return best;
}

// ------------------------- Inference -------------------------
type InferredTrigger =
  | 'scheduler'
  | 'updater-manual'
  | 'backfill-script'
  | 'symbol-added'
  | 'unknown';

function inferTriggerForLog(row: any): { inferredTrigger: InferredTrigger; confidence: number } {
  const md = row?.metadata || {};
  const ts = toJsDate(row.timestamp);

  // Heuristic 1: Scheduler cron windows (high confidence)
  const cronWindows = [
    AV_REFRESH_MANAGER_SCHEDULE,
    TS_DAILY_PRE_CLOSE_SCHEDULE,
    TS_DAILY_POST_CLOSE_SCHEDULE,
    DAILY_TIME_SERIES_UPDATE_SCHEDULE,
  ]
    .map(cronMinutesOfDay)
    .filter((v): v is number => v != null);

  if (ts && !isNaN(ts.getTime())) {
    const mod = minutesOfDayUTC(ts);
    const windowMin = Number(getArg('windowMin', '5'));

    // For each ET window, test both EDT and EST conversions
    for (const etMin of cronWindows) {
      const candidates = etMinutesToUtcCandidates(etMin);
      for (const c of candidates) {
        if (Math.abs(mod - c) <= windowMin) {
          return { inferredTrigger: 'scheduler', confidence: 0.95 };
        }
        // Also handle wrap-around near midnight by comparing circular distance
        const circ = Math.min(Math.abs(mod - c), 24 * 60 - Math.abs(mod - c));
        if (circ <= windowMin) {
          return { inferredTrigger: 'scheduler', confidence: 0.95 };
        }
      }
    }
  }

  // AV-only: Skip 15-minute cadence heuristic (Benzinga-specific). No action here.

  // Heuristic 3: Updater manual
  // Per product guidance, any refresh outside scheduled windows is considered manual.
  // If user metadata exists, confidence is higher; otherwise still classify as manual with modest confidence.
  if (ts && !isNaN(ts.getTime())) {
    if (md?.userId || md?.userAgent || md?.ipAddress) {
      return { inferredTrigger: 'updater-manual', confidence: 0.9 };
    }
    return { inferredTrigger: 'updater-manual', confidence: 0.7 };
  }

  // Heuristic 4: Backfill-like patterns
  // If during off-hours (e.g., late-night UTC) and no UA, mark backfill with modest confidence.
  if (ts) {
    const hour = ts.getUTCHours();
    if ((hour >= 0 && hour < 5) && !md?.userAgent) {
      return { inferredTrigger: 'backfill-script', confidence: 0.6 };
    }
  }

  return { inferredTrigger: 'unknown', confidence: 0.3 };
}

// ------------------------- Main -------------------------
async function main() {
  const from = parseDateISO(getArg('from'));
  const to = parseDateISO(getArg('to'));
  const endpoint = getArg('endpoint');
  const symbol = getArg('symbol');
  const limit = Number(getArg('limit', '500'));
  const offset = Number(getArg('offset', '0'));
  const dryRun = parseBool(getArg('dryRun', '0')) ?? false;
  const verbose = parseBool(getArg('verbose', '0')) ?? false;
  const writeUnknown = parseBool(getArg('writeUnknown', '0')) ?? false;

  console.log('[infer-trigger] start', {
    from: from?.toISOString(),
    to: to?.toISOString(),
    endpoint,
    symbol,
    limit,
    offset,
    dryRun,
    verbose,
    windowMin: Number(getArg('windowMin', '5')),
    writeUnknown,
  });

  let q: FirebaseFirestore.Query = db.collection(FirestoreCollection.REQUEST_LOGS);
  if (from) q = q.where('timestamp', '>=', from);
  if (to) q = q.where('timestamp', '<=', to);
  if (endpoint) q = q.where('endpointId', '==', endpoint);
  if (symbol) q = q.where('symbol', '==', symbol);
  q = q.orderBy('timestamp', 'desc').limit(limit).offset(offset);

  const snap = await q.get();
  if (snap.empty) {
    console.log('[infer-trigger] no rows');
    return;
  }

  const batch = db.batch();
  let updates = 0;

  for (const doc of snap.docs) {
    const d = doc.data() || {};
    const md = d.metadata || {};

    // Preserve explicit trigger if present
    if (md.trigger) continue;

    const { inferredTrigger } = inferTriggerForLog(d);
    if (verbose) {
      const ts = toJsDate(d.timestamp);
      const windowMin = Number(getArg('windowMin', '5'));
      const nearest = ts ? nearestAvScheduleDeltaMinutes(ts, windowMin) : null;
      const iso = ts ? ts.toISOString() : String(d.timestamp);
      const nearestStr = nearest ? `${nearest.name} (delta=${nearest.delta.toFixed(1)}m)` : 'none';
      console.log(`[infer-trigger] analyze ${doc.id} endpoint=${d.endpointId} symbol=${d.symbol} ts=${iso} nearest=${nearestStr} -> ${inferredTrigger}`);
    }
    if (inferredTrigger === 'unknown' && !writeUnknown) continue; // skip writing unknowns unless flag set

    // Write trigger with '(inferred)' suffix
    const triggerWithSuffix = `${inferredTrigger} (inferred)`;

    const patch = {
      metadata: {
        ...(md || {}),
        trigger: triggerWithSuffix,
      },
    };

    if (verbose) {
      console.log(
        `[infer-trigger] ${doc.id} endpoint=${d.endpointId} symbol=${d.symbol} -> ${triggerWithSuffix}`
      );
    }

    if (!dryRun) batch.set(doc.ref, patch, { merge: true });
    updates++;
  }

  if (!dryRun && updates > 0) {
    await batch.commit();
  }

  console.log('[infer-trigger] done', { updates, dryRun });
}

main().catch((e) => {
  console.error('[infer-trigger] fatal', e?.message || e);
  process.exitCode = 1;
});
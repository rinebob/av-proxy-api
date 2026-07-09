import { db } from '../../../firebase-admin-init';
import { Timestamp } from 'firebase-admin/firestore';

import { AlphaVantageEndpoint } from '@shared/alpha-vantage';
import { ApiProvider } from '@shared/core';
import { CompactBar } from '@shared/alpha-vantage';

import {
  getSymbolTimeSeriesYearDocPath,
  getYearFromEpochMillis,
} from '../../common/firestore/firestore-paths';
import {
  buildLatestMetadataFromBars,
  computeChangeMetrics,
  computeDowFromDateString,
  findImmediatePredecessorBar,
  INTRADAY_TIME_FORMATTER,
} from './av-firestore-utils';
import { INTRADAY_FIRST_TICK } from '../jobs/job-config';
import type { IntradayRthBarAggregate } from '../utils';

/**
 * Upsert a daily intraday bar, writing the aggregated RTH OHLCV into the
 * standard bar fields and also preserving the legacy `i*` snapshot fields
 * (`ip/io/it/ic/ipc`) during the rollout period.
 *
 * The nightly POST run will overwrite `o/h/l/c/v` with finalized EOD values.
 */
export async function upsertAvDailyIntradayBar(options: {
  symbol: string;
  date: string; // YYYY-MM-DD (ET-derived trading date)
  bar: IntradayRthBarAggregate;
  clockPt?: string;
}): Promise<void> {
  const { symbol, date, bar, clockPt } = options;
  const dow = computeDowFromDateString(date);
  const barStatus: -1 | 0 = clockPt === INTRADAY_FIRST_TICK ? -1 : 0;
  const vendor = ApiProvider.ALPHA_VANTAGE;
  const t = new Date(`${date}T00:00:00.000Z`).getTime();
  const y = getYearFromEpochMillis(t);
  const yearDocPath = getSymbolTimeSeriesYearDocPath(symbol, AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED, vendor, y);
  const yearRef = db.doc(yearDocPath);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(yearRef);
    const bars: CompactBar[] = snap.exists ? ((snap.get('bars') ?? []) as CompactBar[]) : [];

    let idx = bars.findIndex((b) => b.t === t);
    const itStr = INTRADAY_TIME_FORMATTER.format(new Date(bar.io));

    const prevCandidate = findImmediatePredecessorBar(bars, t);
    const prevClose =
      prevCandidate && (typeof prevCandidate.ac === 'number' ? prevCandidate.ac : prevCandidate.c);
    const { change, changePercent } = computeChangeMetrics(prevClose, bar.c);
    const ic = change ?? 0;
    const ipc = changePercent ?? 0;

    if (idx < 0) {
      const newBar: CompactBar = {
        t,
        d: new Date(t).toISOString().slice(0, 10),
        dow,
        o: bar.o,
        h: bar.h,
        l: bar.l,
        c: bar.c,
        v: bar.v,
        ac: bar.c,
        dv: 0,
        sc: 1,
        ip: bar.c,
        io: bar.io,
        it: itStr,
        ic,
        ipc,
        ch: change,
        cp: changePercent,
        barStatus,
      };
      bars.push(newBar);
      idx = bars.length - 1;
    } else {
      const existing = bars[idx];
      bars[idx] = {
        ...existing,
        o: bar.o,
        h: bar.h,
        l: bar.l,
        c: bar.c,
        v: bar.v,
        ac: bar.c,
        ip: bar.c,
        io: bar.io,
        it: itStr,
        ic,
        ipc,
        ch: change,
        cp: changePercent,
        barStatus,
      };
    }

    bars.sort((a, b) => a.t - b.t);

    tx.set(
      yearRef,
      {
        bars,
        ...buildLatestMetadataFromBars(bars),
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );
  });
}

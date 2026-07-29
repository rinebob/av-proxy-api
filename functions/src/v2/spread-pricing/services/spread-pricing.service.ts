import type { GcsTimeSeriesAdapter } from '../../historical-options-corpus/services/gcs-time-series-adapter.service';
import { parseStorageLine, type TimeSeriesStorageRecord } from '../../historical-options-corpus/services/time-series-contract.utils';
import {
  type LegObservation,
  type SpreadLegRequest,
  type SpreadLegResponse,
  type SpreadObservation,
  type SpreadRequest,
  type SpreadResult,
  type SpreadResultError,
  SpreadErrorCode,
} from '../../partner/spread-request.types';
import { classifyDebitOrCredit } from './spread-validator.utils';
import { buildContractID } from './occ-id-constructor.utils';
import { resolveMark } from './leg-mark-resolver.utils';

const PRICE_PRECISION = 2;
const GREEK_PRECISION = 2;
const GAMMA_PRECISION = 4;

/**
 * Core engine that computes a spread time series from individual leg time series.
 *
 * For each trading day in the intersection of all leg date ranges:
 * 1. Resolves each leg's mark price via the fallback chain
 * 2. Computes spread price: sum(long marks) − sum(short marks)
 * 3. Computes spread Greeks: signed sum of stored leg Greeks
 *
 * No Black-Scholes computation is needed — Greeks are linear and already stored.
 */
export class SpreadPricingService {
  constructor(private readonly gcs: GcsTimeSeriesAdapter) {}

  async computeSpread(request: SpreadRequest): Promise<SpreadResult | SpreadResultError> {
    const symbol = request.symbol.toUpperCase().trim();
    const debitOrCredit = classifyDebitOrCredit(request.spreadType, request.legs);

    const legData = await this.readAllLegs(symbol, request.legs);
    if ('error' in legData) {
      return legData;
    }

    return this.computeSeries(request, legData, debitOrCredit);
  }

  private async readAllLegs(
    symbol: string,
    legs: SpreadLegRequest[],
  ): Promise<LegData[] | SpreadResultError> {
    const legResults = await Promise.all(
      legs.map((leg, i) => this.readSingleLeg(symbol, leg, i)),
    );

    for (const result of legResults) {
      if ('error' in result) return result;
    }

    return legResults as LegData[];
  }

  private async readSingleLeg(
    symbol: string,
    leg: SpreadLegRequest,
    index: number,
  ): Promise<LegData | SpreadResultError> {
    const contractID = buildContractID(symbol, leg.expiration, leg.optionType, leg.strike);

    const lines = await this.gcs.readLines(symbol, contractID);
    if (lines === undefined) {
      return {
        error: `Leg ${index}: contract ${contractID} not found in GCS`,
        code: SpreadErrorCode.NOT_FOUND,
        legIndex: index,
        contractID,
      };
    }

    const records: TimeSeriesStorageRecord[] = [];
    for (const line of lines) {
      const record = parseStorageLine(line);
      if (record) records.push(record);
    }

    if (records.length === 0) {
      return {
        error: `Leg ${index}: contract ${contractID} has no valid observations`,
        code: SpreadErrorCode.NOT_FOUND,
        legIndex: index,
        contractID,
      };
    }

    const dateMap = new Map<string, TimeSeriesStorageRecord>();
    for (const record of records) {
      dateMap.set(record.d, record);
    }

    return {
      leg,
      contractID,
      dateMap,
      firstDate: records[0].d,
      lastDate: records[records.length - 1].d,
      allRecords: records,
    };
  }

  private computeSeries(
    request: SpreadRequest,
    legData: LegData[],
    debitOrCredit: 'debit' | 'credit',
  ): SpreadResult {
    const intersectionDates = this.computeIntersectionDates(legData);

    const startDate = request.startDate;
    const endDate = request.endDate;

    const gaps: string[] = [];
    const series: SpreadObservation[] = [];

    const legLastMarks: (number | null)[] = legData.map(() => null);
    const legSeries: LegObservation[][] = legData.map(() => []);

    for (const date of intersectionDates) {
      if (startDate && date < startDate) continue;
      if (endDate && date > endDate) continue;

      let allLegsResolved = true;
      const legMarks: number[] = [];
      const legGreeks: { delta: number; gamma: number; theta: number; vega: number; rho: number }[] = [];

      for (let i = 0; i < legData.length; i++) {
        const record = legData[i].dateMap.get(date);

        if (!record) {
          allLegsResolved = false;
          break;
        }

        const result = resolveMark(record, legLastMarks[i]);
        if (result.mark === null) {
          allLegsResolved = false;
          break;
        }

        legLastMarks[i] = result.mark;
        legMarks.push(result.mark);
        legGreeks.push(this.extractGreeks(record));
      }

      if (!allLegsResolved) {
        gaps.push(date);
        continue;
      }

      for (let i = 0; i < legData.length; i++) {
        legSeries[i].push({ date, mark: round(legMarks[i], PRICE_PRECISION) });
      }

      const spreadPrice = this.computeSpreadPrice(legMarks, request.legs);
      const spreadGreeks = this.computeSpreadGreeks(legGreeks, request.legs);

      series.push({
        date,
        price: round(spreadPrice, PRICE_PRECISION),
        delta: round(spreadGreeks.delta, GREEK_PRECISION),
        gamma: round(spreadGreeks.gamma, GAMMA_PRECISION),
        theta: round(spreadGreeks.theta, GREEK_PRECISION),
        vega: round(spreadGreeks.vega, GREEK_PRECISION),
        rho: round(spreadGreeks.rho, GREEK_PRECISION),
      });
    }

    const legs = this.buildLegResponses(legData, legSeries);

    const responseStart = series[0]?.date ?? legs[0]?.firstObserved ?? '';
    const responseEnd = series[series.length - 1]?.date ?? legs[0]?.lastObserved ?? '';

    return {
      spreadType: request.spreadType,
      symbol: request.symbol.toUpperCase().trim(),
      debitOrCredit,
      startDate: responseStart,
      endDate: responseEnd,
      gaps,
      legs,
      series,
    };
  }

  private computeIntersectionDates(legData: LegData[]): string[] {
    let start = legData[0].firstDate;
    let end = legData[0].lastDate;

    for (let i = 1; i < legData.length; i++) {
      if (legData[i].firstDate > start) start = legData[i].firstDate;
      if (legData[i].lastDate < end) end = legData[i].lastDate;
    }

    const dateSet = new Set<string>();
    for (const leg of legData) {
      for (const record of leg.allRecords) {
        if (record.d >= start && record.d <= end) {
          dateSet.add(record.d);
        }
      }
    }

    return [...dateSet].sort();
  }

  private computeSpreadPrice(
    marks: number[],
    legs: SpreadLegRequest[],
  ): number {
    let price = 0;
    for (let i = 0; i < legs.length; i++) {
      const sign = legs[i].direction === 'long' ? 1 : -1;
      price += sign * marks[i];
    }
    return price;
  }

  private computeSpreadGreeks(
    greeks: { delta: number; gamma: number; theta: number; vega: number; rho: number }[],
    legs: SpreadLegRequest[],
  ): { delta: number; gamma: number; theta: number; vega: number; rho: number } {
    let delta = 0, gamma = 0, theta = 0, vega = 0, rho = 0;

    for (let i = 0; i < legs.length; i++) {
      const sign = legs[i].direction === 'long' ? 1 : -1;
      delta += sign * greeks[i].delta;
      gamma += sign * greeks[i].gamma;
      theta += sign * greeks[i].theta;
      vega += sign * greeks[i].vega;
      rho += sign * greeks[i].rho;
    }

    return { delta, gamma, theta, vega, rho };
  }

  private extractGreeks(record: TimeSeriesStorageRecord): {
    delta: number; gamma: number; theta: number; vega: number; rho: number;
  } {
    return {
      delta: record.de !== undefined ? Number(record.de) || 0 : 0,
      gamma: record.g !== undefined ? Number(record.g) || 0 : 0,
      theta: record.t !== undefined ? Number(record.t) || 0 : 0,
      vega: record.ve !== undefined ? Number(record.ve) || 0 : 0,
      rho: record.r !== undefined ? Number(record.r) || 0 : 0,
    };
  }

  private buildLegResponses(
    legData: LegData[],
    legSeries: LegObservation[][],
  ): SpreadLegResponse[] {
    return legData.map((data, i) => ({
      contractID: data.contractID,
      expiration: data.leg.expiration,
      strike: data.leg.strike,
      optionType: data.leg.optionType,
      direction: data.leg.direction,
      firstObserved: data.firstDate,
      lastObserved: data.lastDate,
      series: legSeries[i],
    }));
  }
}

interface LegData {
  leg: SpreadLegRequest;
  contractID: string;
  dateMap: Map<string, TimeSeriesStorageRecord>;
  firstDate: string;
  lastDate: string;
  allRecords: TimeSeriesStorageRecord[];
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

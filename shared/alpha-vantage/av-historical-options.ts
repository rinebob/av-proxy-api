import { ApiProvider } from '../core';
import type { TimestampLike } from '../firestore/timestamp';
import { AlphaVantageEndpoint } from './av-endpoints';

type Timestamp = TimestampLike;

export enum AvOptionType {
  CALL = 'call',
  PUT = 'put',
}

export interface AvOptionContract {
  contractID?: string;
  symbol?: string;
  expiration?: string;
  strike?: string;
  type?: AvOptionType;
  last?: string;
  mark?: string;
  bid?: string;
  bid_size?: string;
  ask?: string;
  ask_size?: string;
  volume?: string;
  open_interest?: string;
  date?: string;
  implied_volatility?: string;
  delta?: string;
  gamma?: string;
  theta?: string;
  vega?: string;
  rho?: string;
}

export interface AvHistoricalOptionsResponse {
  endpoint: string;
  message: string;
  data: AvOptionContract[];
}

/**
 * Options analysis summary statistics
 */
export interface SvtOptionsAnalysisSummary {
  totalContracts: number;
  totalVolume: number;
  totalOpenInterest: number;
  callContracts: number;
  putContracts: number;
  uniqueStrikes: number;
  avgVolumePerContract: number;
  avgOpenInterest: number;
}

/**
 * Options analysis for a specific expiration date
 */
export interface SvtExpirationAnalysis {
  expiration: string;
  contractCount: number;
  timeUntilExpiration: string;
  callVolume: number;
  putVolume: number;
  callOpenInterest: number;
  putOpenInterest: number;
}

/**
 * Options analysis for a specific strike price
 */
export interface SvtStrikeAnalysis {
  strike: string;
  callVolume: number;
  putVolume: number;
  callOpenInterest: number;
  putOpenInterest: number;
  totalVolume: number;
  totalOpenInterest: number;
}

/**
 * Complete options analysis results
 */
export interface SvtOptionsAnalysis {
  summary: SvtOptionsAnalysisSummary;
  expirations: SvtExpirationAnalysis[];
  strikes: SvtStrikeAnalysis[];
}

/**
 * Firestore document structure for storing historical options data and analysis
 */
export interface SvtHistoricalOptionsDocument {
  // Metadata
  symbol: string;
  expiration: string;
  dateRequested: Timestamp;
  source: ApiProvider;
  endpoint: AlphaVantageEndpoint;

  // Raw API response
  response: AvHistoricalOptionsResponse;

  // Analysis results
  analysis: SvtOptionsAnalysis;
}
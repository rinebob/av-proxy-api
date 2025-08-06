// Use a generic type for Firestore timestamps in shared code to avoid backend/frontend conflicts.
export type FirestoreTimestamp = any;

import type { RequestConfig, EndpointSymbolUsage } from '../core/types';
import type { SvtBzNewsRequest, BzCalendarRequestType } from './bz-endpoints';
import type { BzNewsChannel } from './bz-news-channels';

export type BenzingaRequestId = BzCalendarRequestType | SvtBzNewsRequest;

export interface BenzingaRequestConfig extends RequestConfig<BenzingaRequestId> {
  apiKeyEnv: string;
  id: BenzingaRequestId;
  parameterKeys: string[];
  symbolUsage: EndpointSymbolUsage;
}

export interface BenzingaNewsRequestConfig extends BenzingaRequestConfig {
  channels?: BzNewsChannel[];
}

// Define the shared BenzingaCalendarParameter enum
export enum BenzingaCalendarParameter {
    PAGE = 'page',
    PAGESIZE = 'pagesize',
    DATE = 'parameters[date]',
    DATE_FROM = 'parameters[date_from]',
    DATE_TO = 'parameters[date_to]',
    DATE_SORT = 'parameters[date_sort]',
    TICKERS = 'parameters[tickers]',
    IMPORTANCE = 'parameters[importance]',
    UPDATED = 'parameters[updated]',
    DIVIDEND_YIELD = 'parameters[dividend_yield]',
    ACTION = 'parameters[action]',
}
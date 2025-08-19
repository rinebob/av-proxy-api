// Use a generic type for Firestore timestamps in shared code to avoid backend/frontend conflicts.
export type FirestoreTimestamp = any;

import type { RequestConfig, EndpointSymbolUsage } from '../core/types';
import type { SvtBzNewsRequest, BzCalendarRequestType } from './bz-endpoints';
import type { BzNewsChannel } from './bz-news-channels';

export type BenzingaRequestId = BzCalendarRequestType | SvtBzNewsRequest;

/**
 * Base configuration for Benzinga API requests
 * Extends the base RequestConfig with Benzinga-specific properties
 */
// export interface BenzingaRequestConfig extends Omit<RequestConfig<BenzingaRequestId>, 'parameters'> {
export interface BenzingaRequestConfig extends RequestConfig<BenzingaRequestId> {
    id: BenzingaRequestId;

    /**
     * Environment variable name containing the Benzinga API key
     */
    apiKeyEnv: string;

    /**
     * How symbols are used in this endpoint
     */
    symbolUsage: EndpointSymbolUsage;

    /**
     * The key used in the API response to access the items array.
     * If not provided, defaults to the endpoint name in lowercase.
     * Example: For Economics endpoint, responseKey would be 'economics'.
     */
    responseKey: string;
}

/**
 * Configuration for Benzinga News API requests
 * Extends BenzingaRequestConfig with news-specific properties
 */
export interface BenzingaNewsRequestConfig extends BenzingaRequestConfig {
    /**
     * Optional list of news channels to filter by
     */
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
    DIVIDEND_YIELD_OPERATION = 'parameters[dividend_yield_operation]',
    ACTION = 'parameters[action]',
    SIMPLIFY = 'simplify',
    AGGREGATE_TYPE = 'aggregate_type',
    COUNTRY = 'parameters[country]',
    EVENT_CATEGORY = 'parameters[event_category]',
    IS_PRIMARY = 'parameters[is_primary]',
    ANALYST_ID = 'parameters[analyst_id]',
    FIRM_ID = 'parameters[firm_id]',
    ANALYST = 'analyst',
    FIRM = 'firm',
}
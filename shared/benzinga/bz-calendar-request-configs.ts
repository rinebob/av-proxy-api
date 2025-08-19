import { ApiProvider } from '../core/data-providers';
import { HttpMethod, EndpointSymbolUsage } from '../core/types';
import { FirestoreCollection } from '../firestore/firestore';
import {
    BzCalendarRequestType,
    BenzingaEndpoint,
    BzEndpointCategory,
} from './bz-endpoints';
import {
    BenzingaCalendarParameter,
    BenzingaRequestConfig,
} from './bz-types';

// Shared parameter definitions map
export const BZ_CALENDAR_PARAMETER_DEFS: Record<BenzingaCalendarParameter, any> = {
    [BenzingaCalendarParameter.PAGE]: {
        type: 'number',
        required: false,
        description: 'Page offset. For optimization, offsets are limited from 0 - 100000. Limit query results by other parameters such as date.',
        default: 0,
    },
    [BenzingaCalendarParameter.PAGESIZE]: {
        type: 'number',
        required: false,
        description: 'Number of results returned. Limit 1000',
        default: 100,
    },
    [BenzingaCalendarParameter.DATE]: {
        type: 'string',
        required: false,
        description: 'Date to query for calendar data. Shorthand for date_from and date_to if they are the same. Defaults for latest.',
        format: 'YYYY-MM-DD',
    },
    [BenzingaCalendarParameter.DATE_FROM]: {
        type: 'string',
        required: false,
        description: 'Date to query from point in time.',
        format: 'YYYY-MM-DD',
    },
    [BenzingaCalendarParameter.DATE_TO]: {
        type: 'string',
        required: false,
        description: 'Date to query to point in time.',
        format: 'YYYY-MM-DD',
    },
    [BenzingaCalendarParameter.DATE_SORT]: {
        type: 'string',
        required: false,
        description: 'Field sort option for earnings calendar. Apply :desc, :asc for sort order.',
        enum: ['date'],
    },
    [BenzingaCalendarParameter.TICKERS]: {
        type: 'string',
        required: false,
        description: 'One or more ticker symbols separated by a comma. All calendars accept this parameter (except FDA endpoint). Max 50 tickers.',
        format: 'csv',
    },
    [BenzingaCalendarParameter.IMPORTANCE]: {
        type: 'number',
        required: false,
        description: 'The importance level to filter by. Uses Greater Than or Equal To the importance indicated.',
        enum: [0, 1, 2, 3, 4, 5],
    },
    [BenzingaCalendarParameter.UPDATED]: {
        type: 'number',
        required: false,
        description: 'Records last Updated Unix timestamp (UTC). This will force the sort order to be Greater Than or Equal to the timestamp indicated.',
    },
    [BenzingaCalendarParameter.DIVIDEND_YIELD]: {
        type: 'number',
        required: false,
        description: 'Dividend yield filter. Value is a decimal (e.g., 0.05 for 5%).',
    },
    [BenzingaCalendarParameter.ACTION]: {
        type: 'string',
        required: false,
        description: 'Rating action filter (e.g., upgrade, downgrade, initiate, reiterate, maintain).',
        enum: ['upgrade', 'downgrade', 'initiate', 'reiterate', 'maintain'],
    },
};

// Common parameters shared by all calendar endpoints
export const BZ_CALENDAR_COMMON_PARAMS: BenzingaCalendarParameter[] = [
    BenzingaCalendarParameter.PAGE,
    BenzingaCalendarParameter.PAGESIZE,
    BenzingaCalendarParameter.DATE,
    BenzingaCalendarParameter.DATE_FROM,
    BenzingaCalendarParameter.DATE_TO,
    BenzingaCalendarParameter.UPDATED,
];

// Utility to resolve full parameter object for an endpoint
export function getBzCalendarParams(keys: BenzingaCalendarParameter[]): Record<string, any> {
    const params: Record<string, any> = {};
    for (const key of keys) {
        params[key] = BZ_CALENDAR_PARAMETER_DEFS[key];
    }
    return params;
}

// Base configuration that can be extended by specific endpoints
const BASE_CALENDAR_REQUEST_CONFIG: Omit<BenzingaRequestConfig, 'id' | 'name' | 'apiEndpoint' | 'description'> & { apiKeyEnv: string } = {
    apiKeyEnv: 'BENZINGA_CALENDAR_API_KEY',
    provider: ApiProvider.BENZINGA,
    category: BzEndpointCategory.BENZINGA_CALENDAR,
    method: HttpMethod.GET,
    ttl: 60 * 60, // 1 hour
    symbolUsage: EndpointSymbolUsage.OPTIONAL,
    documentationUrl: 'https://docs.benzinga.com/benzinga/calendar-v2.html',
    parameterKeys: [
        // Common parameters used by most endpoints
        BenzingaCalendarParameter.PAGE,
        BenzingaCalendarParameter.PAGESIZE,
        BenzingaCalendarParameter.DATE_FROM,
        BenzingaCalendarParameter.DATE_TO,
        BenzingaCalendarParameter.DATE,
        BenzingaCalendarParameter.DATE_SORT,
        BenzingaCalendarParameter.TICKERS
    ],
    responseKey: '',
};

export const BZ_CALENDAR_REQUEST_CONFIGS: Record<BzCalendarRequestType, BenzingaRequestConfig> = {
    [BzCalendarRequestType.EARNINGS]: {
        ...BASE_CALENDAR_REQUEST_CONFIG,
        id: BzCalendarRequestType.EARNINGS,
        name: 'Earnings',
        apiEndpoint: `/${BenzingaEndpoint.CALENDAR}/${BzCalendarRequestType.EARNINGS}`,
        description: 'Returns earnings data for companies',
        firestorePath: `${FirestoreCollection.SYMBOL_DATA}/{symbol}/${FirestoreCollection.EARNINGS}/bz-${FirestoreCollection.EARNINGS}`,
        parameterKeys: [
            ...BASE_CALENDAR_REQUEST_CONFIG.parameterKeys,
            BenzingaCalendarParameter.IMPORTANCE
        ],
        responseKey: BzCalendarRequestType.EARNINGS,
    },
    [BzCalendarRequestType.DIVIDENDS]: {
        ...BASE_CALENDAR_REQUEST_CONFIG,
        id: BzCalendarRequestType.DIVIDENDS,
        name: 'Dividends',
        apiEndpoint: `/${BenzingaEndpoint.CALENDAR}/${BzCalendarRequestType.DIVIDENDS}`,
        description: 'Returns dividend data for companies',
        firestorePath: `${FirestoreCollection.SYMBOL_DATA}/{symbol}/${FirestoreCollection.DIVIDENDS}/bz-${FirestoreCollection.DIVIDENDS}`,
        parameterKeys: [
            ...BASE_CALENDAR_REQUEST_CONFIG.parameterKeys,
            BenzingaCalendarParameter.DIVIDEND_YIELD,
            BenzingaCalendarParameter.DIVIDEND_YIELD_OPERATION
        ],
        responseKey: BzCalendarRequestType.DIVIDENDS,
    },
    [BzCalendarRequestType.CONFERENCE_CALLS]: {
        ...BASE_CALENDAR_REQUEST_CONFIG,
        id: BzCalendarRequestType.CONFERENCE_CALLS,
        name: 'Conference Calls',
        apiEndpoint: `/${BenzingaEndpoint.CALENDAR}/${BzCalendarRequestType.CONFERENCE_CALLS}`,
        description: 'Returns conference call information',
        firestorePath: `${FirestoreCollection.SYMBOL_DATA}/{symbol}/${FirestoreCollection.CONFERENCE_CALLS}/bz-${FirestoreCollection.CONFERENCE_CALLS}`,
        parameterKeys: [
            ...BASE_CALENDAR_REQUEST_CONFIG.parameterKeys
        ],
        responseKey: 'conference'
    },  
    [BzCalendarRequestType.RATINGS]: {
        ...BASE_CALENDAR_REQUEST_CONFIG,
        id: BzCalendarRequestType.RATINGS,
        name: 'Analyst Ratings',
        apiEndpoint: `/${BenzingaEndpoint.CALENDAR}/${BzCalendarRequestType.RATINGS}`,
        description: 'Returns analyst ratings for companies',
        firestorePath: `${FirestoreCollection.SYMBOL_DATA}/{symbol}/${FirestoreCollection.RATINGS}/bz-${FirestoreCollection.RATINGS}`,
        parameterKeys: [
            ...BASE_CALENDAR_REQUEST_CONFIG.parameterKeys,
            BenzingaCalendarParameter.ACTION
        ],
        responseKey: BzCalendarRequestType.RATINGS,
    },
    [BzCalendarRequestType.GUIDANCE]: {
        ...BASE_CALENDAR_REQUEST_CONFIG,
        id: BzCalendarRequestType.GUIDANCE,
        name: 'Guidance',
        apiEndpoint: `/${BenzingaEndpoint.CALENDAR}/${BzCalendarRequestType.GUIDANCE}`,
        description: 'Returns company guidance',
        firestorePath: `${FirestoreCollection.SYMBOL_DATA}/{symbol}/${FirestoreCollection.GUIDANCE}/bz-${FirestoreCollection.GUIDANCE}`,
        parameterKeys: [
            ...BASE_CALENDAR_REQUEST_CONFIG.parameterKeys,
            BenzingaCalendarParameter.IS_PRIMARY
        ],
        responseKey: BzCalendarRequestType.GUIDANCE,
    },
    [BzCalendarRequestType.SPLITS]: {
        ...BASE_CALENDAR_REQUEST_CONFIG,
        id: BzCalendarRequestType.SPLITS,
        name: 'Stock Splits',
        apiEndpoint: `/${BenzingaEndpoint.CALENDAR}/${BzCalendarRequestType.SPLITS}`,
        description: 'Returns stock split information',
        firestorePath: `${FirestoreCollection.SYMBOL_DATA}/{symbol}/${FirestoreCollection.SPLITS}/bz-${FirestoreCollection.SPLITS}`,
        parameterKeys: [
            ...BASE_CALENDAR_REQUEST_CONFIG.parameterKeys,
        ],
        responseKey: BzCalendarRequestType.SPLITS,
    },
    [BzCalendarRequestType.OFFERINGS]: {
        ...BASE_CALENDAR_REQUEST_CONFIG,
        id: BzCalendarRequestType.OFFERINGS,
        name: 'Offerings',
        apiEndpoint: `/${BenzingaEndpoint.CALENDAR}/${BzCalendarRequestType.OFFERINGS}`,
        description: 'Returns company offerings',
        firestorePath: `${FirestoreCollection.SYMBOL_DATA}/{symbol}/${FirestoreCollection.OFFERINGS}/bz-${FirestoreCollection.OFFERINGS}`,
        parameterKeys: [
            ...BASE_CALENDAR_REQUEST_CONFIG.parameterKeys,
        ],
        responseKey: '',
    },
    [BzCalendarRequestType.ECONOMICS]: {
        ...BASE_CALENDAR_REQUEST_CONFIG,
        id: BzCalendarRequestType.ECONOMICS,
        symbolUsage: EndpointSymbolUsage.NOT_SUPPORTED,
        name: 'Economics Calendar',
        apiEndpoint: `/${BenzingaEndpoint.CALENDAR}/${BzCalendarRequestType.ECONOMICS}`,
        description: 'Returns economic calendar data',
        firestorePath: `${FirestoreCollection.ECONOMICS}/bz-${FirestoreCollection.ECONOMIC_CALENDAR}`,
        parameterKeys: [
            ...BASE_CALENDAR_REQUEST_CONFIG.parameterKeys,
            BenzingaCalendarParameter.COUNTRY,
            BenzingaCalendarParameter.EVENT_CATEGORY
        ],
        responseKey: BzCalendarRequestType.ECONOMICS,
    },
    [BzCalendarRequestType.IPOS]: {
        ...BASE_CALENDAR_REQUEST_CONFIG,
        id: BzCalendarRequestType.IPOS,
        symbolUsage: EndpointSymbolUsage.NOT_SUPPORTED,
        name: 'IPOs',
        apiEndpoint: `/${BenzingaEndpoint.CALENDAR}/${BzCalendarRequestType.IPOS}`,
        description: 'Returns IPO calendar data',
        firestorePath: `${FirestoreCollection.MARKET_DATA}/bz-${FirestoreCollection.IPOS}`,
        parameterKeys: [
            ...BASE_CALENDAR_REQUEST_CONFIG.parameterKeys,
        ],
        responseKey: BzCalendarRequestType.IPOS,
    },
    [BzCalendarRequestType.MERGERS_ACQUISITIONS]: {
        ...BASE_CALENDAR_REQUEST_CONFIG,
        id: BzCalendarRequestType.MERGERS_ACQUISITIONS,
        symbolUsage: EndpointSymbolUsage.OPTIONAL,
        name: 'Mergers & Acquisitions',
        apiEndpoint: `/${BenzingaEndpoint.CALENDAR}/${BzCalendarRequestType.MERGERS_ACQUISITIONS}`,
        description: 'Returns M&A activity data',
        firestorePath: `${FirestoreCollection.MARKET_DATA}/bz-${FirestoreCollection.MERGERS_ACQUISITIONS}`,
        parameterKeys: [
            ...BASE_CALENDAR_REQUEST_CONFIG.parameterKeys,
        ],
        responseKey: 'ma',
    },
}

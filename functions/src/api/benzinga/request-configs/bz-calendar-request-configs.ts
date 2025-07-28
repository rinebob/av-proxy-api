import { ApiProvider } from '../../../common/data-providers';
import { EndpointCategory, HttpMethod } from '../../common/enums';
import { FirestoreCollection } from '../../../common/firestore-collections';
import {
    BenzingaEndpoint,
    BenzingaRequestConfig,
    BenzingaCalendarParameter,
    BzCalendarRequestType,
} from '../../../common/common-benz';
import { EndpointConfig } from '../../common/types';

// Benzinga-specific endpoint config interface
import { EndpointSymbolUsage } from '../../../common/common-fn';

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
const BASE_CALENDAR_REQUEST_CONFIG: Omit<EndpointConfig, 'id' | 'name' | 'apiEndpoint' | 'description'> & { apiKeyEnv: string } = {
    apiKeyEnv: 'BENZINGA_CALENDAR_API_KEY',
    provider: ApiProvider.BENZINGA,
    category: EndpointCategory.BENZINGA_CALENDAR,
    method: HttpMethod.GET,
    ttl: 2 * 60, // 2 minutes
    requiresSymbol: true,
    parameters: {
        [BenzingaCalendarParameter.DATE_FROM]: {
            type: 'string',
            required: false,
            description: 'Start date (YYYY-MM-DD)',
        },
        [BenzingaCalendarParameter.DATE_TO]: {
            type: 'string',
            required: false,
            description: 'End date (YYYY-MM-DD)',
        },
        [BenzingaCalendarParameter.PAGE]: {
            type: 'number',
            required: false,
            description: 'Page number of results',
            default: 1,
        },
        [BenzingaCalendarParameter.PAGESIZE]: {
            type: 'number',
            required: false,
            description: 'Number of results per page',
            default: 100,
        },
    },
    documentationUrl: 'https://docs.benzinga.com/benzinga/calendar-v2.html',
};

export const BZ_CALENDAR_REQUEST_CONFIGS: Record<BzCalendarRequestType, BenzingaRequestConfig> = {
    [BzCalendarRequestType.EARNINGS]: {
        ...BASE_CALENDAR_REQUEST_CONFIG,
        id: BzCalendarRequestType.EARNINGS,
        symbolUsage: EndpointSymbolUsage.REQUIRED,
        name: 'Earnings',
        apiEndpoint: `/${BenzingaEndpoint.CALENDAR}/${BzCalendarRequestType.EARNINGS}`,
        description: 'Returns earnings data for companies',
        firestorePath: `${FirestoreCollection.COMPANY_DATA}/{symbol}/${FirestoreCollection.EARNINGS}/bz-${FirestoreCollection.EARNINGS}`,
        parameterKeys: [
          ...BZ_CALENDAR_COMMON_PARAMS,
          BenzingaCalendarParameter.DATE_SORT,
          BenzingaCalendarParameter.TICKERS,
          BenzingaCalendarParameter.IMPORTANCE
        ],
      },
      [BzCalendarRequestType.DIVIDENDS]: {
        ...BASE_CALENDAR_REQUEST_CONFIG,
        id: BzCalendarRequestType.DIVIDENDS,
        symbolUsage: EndpointSymbolUsage.REQUIRED,
        name: 'Dividends',
        apiEndpoint: `/${BenzingaEndpoint.CALENDAR}/${BzCalendarRequestType.DIVIDENDS}`,
        description: 'Returns dividend data for companies',
        firestorePath: `${FirestoreCollection.COMPANY_DATA}/{symbol}/${FirestoreCollection.DIVIDENDS}/bz-${FirestoreCollection.DIVIDENDS}`,
        parameterKeys: [
          ...BZ_CALENDAR_COMMON_PARAMS,
          BenzingaCalendarParameter.TICKERS,
          BenzingaCalendarParameter.DIVIDEND_YIELD
        ],
      },
      [BzCalendarRequestType.CONFERENCE_CALLS]: {
        ...BASE_CALENDAR_REQUEST_CONFIG,
        id: BzCalendarRequestType.CONFERENCE_CALLS,
        symbolUsage: EndpointSymbolUsage.REQUIRED,
        name: 'Conference Calls',
        apiEndpoint: `/${BenzingaEndpoint.CALENDAR}/${BzCalendarRequestType.CONFERENCE_CALLS}`,
        description: 'Returns conference call information',
        firestorePath: `${FirestoreCollection.COMPANY_DATA}/{symbol}/${FirestoreCollection.CONFERENCE_CALLS}/bz-${FirestoreCollection.CONFERENCE_CALLS}`,
        parameterKeys: [
          ...BZ_CALENDAR_COMMON_PARAMS,
          BenzingaCalendarParameter.TICKERS
        ],
      },
      [BzCalendarRequestType.RATINGS]: {
        ...BASE_CALENDAR_REQUEST_CONFIG,
        id: BzCalendarRequestType.RATINGS,
        symbolUsage: EndpointSymbolUsage.REQUIRED,
        name: 'Analyst Ratings',
        apiEndpoint: `/${BenzingaEndpoint.CALENDAR}/${BzCalendarRequestType.RATINGS}`,
        description: 'Returns analyst ratings for companies',
        firestorePath: `${FirestoreCollection.COMPANY_DATA}/{symbol}/${FirestoreCollection.RATINGS}/bz-${FirestoreCollection.RATINGS}`,
        parameterKeys: [
          ...BZ_CALENDAR_COMMON_PARAMS,
          BenzingaCalendarParameter.TICKERS,
          BenzingaCalendarParameter.ACTION
        ],
      },
      [BzCalendarRequestType.GUIDANCE]: {
        ...BASE_CALENDAR_REQUEST_CONFIG,
        id: BzCalendarRequestType.GUIDANCE,
        symbolUsage: EndpointSymbolUsage.REQUIRED,
        name: 'Guidance',
        apiEndpoint: `/${BenzingaEndpoint.CALENDAR}/${BzCalendarRequestType.GUIDANCE}`,
        description: 'Returns company guidance',
        firestorePath: `${FirestoreCollection.COMPANY_DATA}/{symbol}/${FirestoreCollection.GUIDANCE}/bz-${FirestoreCollection.GUIDANCE}`,
        parameterKeys: [
          ...BZ_CALENDAR_COMMON_PARAMS,
          BenzingaCalendarParameter.TICKERS
        ],
      },
      [BzCalendarRequestType.SPLITS]: {
        ...BASE_CALENDAR_REQUEST_CONFIG,
        id: BzCalendarRequestType.SPLITS,
        symbolUsage: EndpointSymbolUsage.REQUIRED,
        name: 'Stock Splits',
        apiEndpoint: `/${BenzingaEndpoint.CALENDAR}/${BzCalendarRequestType.SPLITS}`,
        description: 'Returns stock split information',
        firestorePath: `${FirestoreCollection.COMPANY_DATA}/{symbol}/${FirestoreCollection.SPLITS}/bz-${FirestoreCollection.SPLITS}`,
        parameterKeys: [
          ...BZ_CALENDAR_COMMON_PARAMS,
          BenzingaCalendarParameter.TICKERS
        ],
      },
      [BzCalendarRequestType.OFFERINGS]: {
        ...BASE_CALENDAR_REQUEST_CONFIG,
        id: BzCalendarRequestType.OFFERINGS,
        symbolUsage: EndpointSymbolUsage.REQUIRED,
        name: 'Offerings',
        apiEndpoint: `/${BenzingaEndpoint.CALENDAR}/${BzCalendarRequestType.OFFERINGS}`,
        description: 'Returns company offerings',
        firestorePath: `${FirestoreCollection.COMPANY_DATA}/{symbol}/${FirestoreCollection.OFFERINGS}/bz-${FirestoreCollection.OFFERINGS}`,
        parameterKeys: [
          ...BZ_CALENDAR_COMMON_PARAMS,
          BenzingaCalendarParameter.TICKERS
        ],
      },
      [BzCalendarRequestType.ECONOMICS]: {
        ...BASE_CALENDAR_REQUEST_CONFIG,
        id: BzCalendarRequestType.ECONOMICS,
        symbolUsage: EndpointSymbolUsage.NOT_SUPPORTED,
        name: 'Economics Calendar',
        apiEndpoint: `/${BenzingaEndpoint.CALENDAR}/${BzCalendarRequestType.ECONOMICS}`,
        description: 'Returns economic calendar data',
        requiresSymbol: false,
        firestorePath: `${FirestoreCollection.ECONOMICS}/bz-${FirestoreCollection.ECONOMIC_CALENDAR}`,
        parameterKeys: [
          ...BZ_CALENDAR_COMMON_PARAMS
        ],
      },
      [BzCalendarRequestType.IPOS]: {
        ...BASE_CALENDAR_REQUEST_CONFIG,
        id: BzCalendarRequestType.IPOS,
        symbolUsage: EndpointSymbolUsage.NOT_SUPPORTED,
        name: 'IPOs',
        apiEndpoint: `/${BenzingaEndpoint.CALENDAR}/${BzCalendarRequestType.IPOS}`,
        description: 'Returns IPO calendar data',
        requiresSymbol: false,
        firestorePath: `${FirestoreCollection.MARKET_DATA}/bz-${FirestoreCollection.IPOS}`,
        parameterKeys: [
          ...BZ_CALENDAR_COMMON_PARAMS
        ],
      },
      [BzCalendarRequestType.MERGERS_ACQUISITIONS]: {
        ...BASE_CALENDAR_REQUEST_CONFIG,
        id: BzCalendarRequestType.MERGERS_ACQUISITIONS,
        symbolUsage: EndpointSymbolUsage.NOT_SUPPORTED,
        name: 'Mergers & Acquisitions',
        apiEndpoint: `/${BenzingaEndpoint.CALENDAR}/${BzCalendarRequestType.MERGERS_ACQUISITIONS}`,
        description: 'Returns M&A activity data',
        requiresSymbol: false,
        firestorePath: `${FirestoreCollection.MARKET_DATA}/bz-${FirestoreCollection.MERGERS_ACQUISITIONS}`,
        parameterKeys: [
          ...BZ_CALENDAR_COMMON_PARAMS
        ],
      },
    }

// COPIED FROM functions/src/v2/common/common-av.ts. Do not use directly until migration is complete.

/**
 * Alpha Vantage global quote data interface.
 */
export interface GlobalQuoteData {
    "01. symbol": string;
    "02. open": string;
    "03. high": string;
    "04. low": string;
    "05. price": string;
    "06. volume": string;
    "07. latest trading day": string;
    "08. previous close": string;
    "09. change": string;
    "10. change percent": string;
    // Add other expected fields from the GLOBAL_QUOTE response if necessary
}

/**
 * Alpha Vantage global quote API response interface.
 */
export interface AlphaVantageGlobalQuoteResponse {
    "Global Quote"?: GlobalQuoteData; // Optional because it might be an error response
    "Information"?: string; // For API-level errors/info
    "Note"?: string;       // For rate limit messages
    "Error Message"?: string; // For API-level errors
}

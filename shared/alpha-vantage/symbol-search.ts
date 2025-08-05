// COPIED FROM functions/src/v2/common/common-av.ts. Do not use directly until migration is complete.

export interface AlphaVantageSymbolMatch {
    "1. symbol": string;
    "2. name": string;
    "3. type": string;
    "4. region": string;
    "5. marketOpen": string;
    "6. marketClose": string;
    "7. timezone": string;
    "8. currency": string;
    "9. matchScore": string;
}

export interface AlphaVantageSymbolSearchResponse {
    bestMatches: AlphaVantageSymbolMatch[];
}

// =======================================
// DATA MANAGER: Benzinga Data Refresher
// =======================================

import { db } from '../firebase-admin-init';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { ApiProvider } from '../common/data-providers';
import { FirestoreCollection } from '../common/firestore-collections';
import { SvtBzNewsRequest } from '../common/common-benz';

import { BenzingaHandlerFactory } from '../api/benzinga/benzinga-factory';
import type { HandlerKey } from '../api/benzinga/benzinga-factory';
import { BZ_CALENDAR_REQUEST_CONFIGS } from '../api/benzinga/request-configs/bz-calendar-request-configs';



// Logging helper
const pr = true;
function logBZDM(message: string, ...args: any[]) {
    if (pr) console.log(`${message}`, ...args);
}

// Shared Firestore utility functions and enums
import { resolveFirestorePath, resolveRefreshHistoryPath, getRefreshEventDocId } from './firestore-utils';
import { EndpointSymbolUsage } from '../common/common-fn';

// Main scheduled function for refreshing Benzinga data
export const refreshBenzingaData = onSchedule(
    {
        schedule: 'every 1 minute',
        secrets: ['BENZINGA_CALENDAR_API_KEY'],
    },
    async () => {
        logBZDM('==============================================');
        logBZDM('--- bCRM rBD Benzinga Calendar Data Refresh Cycle Started ---');
        const batchStart = Date.now();

        // 1. Get all tracked symbols (assume a collection 'tracked-symbols' exists)
        const symbolsSnap = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
        const symbols = symbolsSnap.docs.map(doc => doc.id);
        logBZDM(`bCRM rBD: Found ${symbols.length} tracked symbols:`, symbols);

        // 2. Combine company and market data requests
        const calendarRequests = { ...BZ_CALENDAR_REQUEST_CONFIGS };

        // 3. For each implemented Benzinga calendar endpoint
        for (const [endpointName, endpointConfig] of Object.entries(calendarRequests)) {

            logBZDM(`**********************************************************************************`);
            logBZDM(`**********************************************************************************`);
            logBZDM(`=========== START ENDPOINT [${endpointName}] ===================================`);
            if (!endpointConfig) {
                logBZDM(`bCRM rBD: No config found for endpoint: ${endpointName}`);
                continue;
            }

            const ttl = endpointConfig.ttl;
            logBZDM(`bCRM rBD: Processing endpoint: ${endpointName} (TTL: ${ttl}s)`);

            // 3. For each symbol (if required)
            const requiresSymbol = endpointConfig.symbolUsage !== EndpointSymbolUsage.NOT_SUPPORTED;
            // For endpoints that don't support symbols, we'll just process once with no symbol
            const targets = endpointConfig.symbolUsage === EndpointSymbolUsage.NOT_SUPPORTED ? [undefined] : symbols;

            for (const symbol of targets) {
                const displayName = requiresSymbol && symbol ? symbol : endpointName;
                logBZDM(`**********************************************************************************`);
                logBZDM(`=========== START ${requiresSymbol ? 'SYMBOL' : 'MARKET DATA'} [${displayName} ${endpointName}] ===================================`);
                logBZDM(`----------- bCRM rBD: START FRESHNESS CHECK FOR [${displayName} ${endpointName}] -------------`);

                // Get the appropriate document path
                let docPath: string;
                if (requiresSymbol) {
                    if (!symbol) {
                        logBZDM(`Skipping - symbol is required but not provided for endpoint: ${endpointName}`);
                        continue;
                    }
                    docPath = resolveFirestorePath(endpointName, symbol);
                } else {
                    // Ensure firestorePath is defined
                    if (!endpointConfig.firestorePath) {
                        logBZDM(`Skipping - no firestorePath configured for endpoint: ${endpointName}`);
                        continue;
                    }
                    docPath = endpointConfig.firestorePath;
                }

                logBZDM(`bCRM rBD: docPath: ${docPath}`);
                const docRef = db.doc(docPath);
                const docSnap = await docRef.get();
                const now = Timestamp.now();
                let needsRefresh = false;

                if (!docSnap.exists) {
                    logBZDM(`bCRM rBD: No data for ${symbol || '(no symbol)'} ${endpointName}, will fetch.`);
                    needsRefresh = true;
                } else {
                    const metadata = docSnap.data()?.metadata;
                    const nextRefreshAt = metadata?.nextRefreshAt;
                    let nextRefreshDate;
                    if (nextRefreshAt) {
                        if (nextRefreshAt.toDate) {
                            nextRefreshDate = nextRefreshAt.toDate();
                        } else if (typeof nextRefreshAt === 'string' || typeof nextRefreshAt === 'number') {
                            nextRefreshDate = new Date(Number(nextRefreshAt));
                        }
                    }
                    // Diagnostic debug logging
                    const nowDate = new Date();
                    logBZDM(`bCRM rBD: [DEBUG] nowDate: ${nowDate.toISOString()} (${nowDate.getTime()} ms)`);
                    logBZDM(`bCRM rBD: [DEBUG] nextRefreshAt (raw):`, nextRefreshAt, `type: ${typeof nextRefreshAt}`);
                    logBZDM(`bCRM rBD: [DEBUG] nextRefreshDate: ${nextRefreshDate ? nextRefreshDate.toISOString() : 'N/A'} (${nextRefreshDate ? nextRefreshDate.getTime() : 'N/A'} ms)`);
                    logBZDM(`bCRM rBD: [DEBUG] nowDate >= nextRefreshDate?`, nextRefreshDate ? nowDate >= nextRefreshDate : 'N/A');
                    if (!nextRefreshDate || now.toDate() >= nextRefreshDate) {
                        logBZDM(`bCRM rBD: Data for ${symbol || '(no symbol)'} ${endpointName} is stale or missing nextRefreshAt.`);
                        needsRefresh = true;
                    } else {
                        logBZDM(`bCRM rBD: Data for ${symbol || '(no symbol)'} ${endpointName} is fresh (nextRefreshAt: ${nextRefreshDate})`);
                    }
                    logBZDM(`----------- bCRM rBD: END FRESHNESS CHECK FOR [${symbol} ${endpointName}] -------------`);
                }

                if (!needsRefresh) continue;

                // 4. Call Benzinga API
                const apiStart = Date.now();
                try {
                    logBZDM(`----------- bCRM rBD: START API CALL FOR [${symbol} ${endpointName}] -------------`);
                    logBZDM(`bCRM rBD: Refreshing ${symbol || '(no symbol)'} ${endpointName} via Benzinga API...`);

                    // Use BenzingaHandlerFactory to create and call the handler
                    if (!BenzingaHandlerFactory.hasHandler(endpointName as HandlerKey)) {
                        throw new Error(`No handler implemented for endpoint: ${endpointName}`);
                    }
                    const handler = BenzingaHandlerFactory.createHandler(endpointName as HandlerKey);

                    // Build params from config and symbol
                    const apiParams: Record<string, any> = {};
                    for (const paramKey of endpointConfig.parameterKeys || []) {
                        if (paramKey === 'symbols' || paramKey === 'parameters[tickers]') {
                            if (symbol) apiParams[paramKey] = symbol;
                        } else if ((endpointConfig as any)[paramKey] !== undefined) {
                            apiParams[paramKey] = (endpointConfig as any)[paramKey];
                        }
                        // Add more param handling as needed
                    }

                    const requestId = `bzdm-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                    const apiResponse = await handler.handleRequest(apiParams, requestId);
                    const durationMs = Date.now() - apiStart;
                    logBZDM(`bCRM rBD: Fetched data for ${symbol || '(no symbol)'} ${endpointName} in ${durationMs}ms.`);
                    logBZDM(`----------- bCRM rBD: END API CALL FOR [${symbol} ${endpointName}] -------------`);

                    // 5. Write to Firestore
                    // If this is a market-data endpoint (requiresSymbol === false) and no data is returned, still write a metadata doc
                    let dataToSave = apiResponse;
                    if (
                        !Object.values(SvtBzNewsRequest).includes(endpointConfig.id as SvtBzNewsRequest) &&
                        dataToSave &&
                        typeof dataToSave === 'object' &&
                        'data' in dataToSave &&
                        Object.keys(dataToSave).length === 1 // Only a single 'data' property
                    ) {
                        dataToSave = dataToSave.data;
                    }
                    // Additional flattening for market-data calendar endpoints (e.g., ipos, fda)
                    if (
                        !requiresSymbol &&
                        dataToSave &&
                        typeof dataToSave === 'object' &&
                        Object.keys(dataToSave).length === 1
                    ) {
                        const onlyKey = Object.keys(dataToSave)[0];
                        if (Array.isArray(dataToSave[onlyKey])) {
                            dataToSave = dataToSave[onlyKey];
                        }
                    }
                    if (!requiresSymbol && (apiResponse == null || (Array.isArray(apiResponse) && apiResponse.length === 0) || (typeof apiResponse === 'object' && Object.keys(apiResponse).length === 0))) {
                        logBZDM(`bCRM rBD: No data returned for market-data endpoint ${endpointName}; writing metadata doc only.`);
                        dataToSave = null;
                    }
                    const PST_TZ = 'America/Los_Angeles';
                    let lastRefreshedAtDate: Date;
                    if (now instanceof Date) {
                        lastRefreshedAtDate = now;
                    } else if (now && typeof now.toDate === 'function') {
                        lastRefreshedAtDate = now.toDate();
                    } else if (typeof now === 'number' || typeof now === 'string') {
                        lastRefreshedAtDate = new Date(now);
                    } else {
                        lastRefreshedAtDate = new Date(); // fallback to current time
                    }
                    const nextRefreshAtDate = new Date(Date.now() + ttl * 1000);
                    const updateData = {
                        data: dataToSave,
                        metadata: {
                            endpoint: endpointName,
                            symbol,
                            nextRefreshAt: nextRefreshAtDate,
                            nextRefreshAtPST: nextRefreshAtDate.toLocaleString('en-US', { timeZone: PST_TZ }),
                            lastRefreshedAt: lastRefreshedAtDate,
                            lastRefreshedAtPST: lastRefreshedAtDate.toLocaleString('en-US', { timeZone: PST_TZ }),
                        },
                        lastRefreshEvent: {
                            timestamp: now,
                            status: 'success',
                            durationMs,
                            error: null,
                        },
                    };
                    logBZDM(`----------- bCRM rBD: START WRITE TO FIRESTORE FOR [${symbol} ${endpointName}] -------------`);
                    await docRef.set(updateData, { merge: true });
                    logBZDM(`bCRM rBD: Saved refreshed data for ${symbol || '(no symbol)'} ${endpointName} to Firestore.`);
                    logBZDM(`----------- bCRM rBD: END WRITE TO FIRESTORE FOR [${symbol} ${endpointName}] -------------`);

                    // Update or create the company document with metadata
                    // Only update company data for endpoints that support symbols
                    if (symbol && endpointConfig.symbolUsage !== EndpointSymbolUsage.NOT_SUPPORTED) {
                        try {
                            const symbolDocRef = db.collection(FirestoreCollection.COMPANY_DATA)
                                .doc(symbol.toUpperCase());

                            const symbolUpdate = {
                                symbol: symbol.toUpperCase(),
                                originalSymbol: symbol,
                                lastUpdated: FieldValue.serverTimestamp(),
                                lastUpdatedBy: `calendar:${endpointName}`,
                                endpoints: {
                                    [endpointName]: {
                                        dataInSubcollection: true,
                                        lastUpdated: FieldValue.serverTimestamp()
                                    }
                                }
                            };

                            await symbolDocRef.set(symbolUpdate, { merge: true });
                            logBZDM(`bCRM rBD: Updated company data for ${symbol} with endpoint ${endpointName}`);
                        } catch (error) {
                            logBZDM(`bCRM rBD: Error updating symbol metadata for ${symbol}:`, error);
                        }
                    }

                    // 6. Log refresh event to history with human-readable doc ID
                    const historyPath = resolveRefreshHistoryPath(endpointName, symbol);
                    logBZDM(`bCRM rBD: Logging refresh event for ${symbol || '(no symbol)'} ${endpointName} to history path: ${historyPath}`);
                    const nowDate = new Date();
                    const refreshEventId = getRefreshEventDocId(ApiProvider.BENZINGA, endpointName, nowDate, symbol);
                    await db.collection(historyPath).doc(refreshEventId).set({
                        ...updateData.lastRefreshEvent,
                        endpoint: endpointName,
                        symbol,
                        vendor: ApiProvider.BENZINGA,
                        timestamp: now,
                    });
                    logBZDM(`bCRM rBD: Logged refresh event for ${symbol || '(no symbol)'} ${endpointName} as ${refreshEventId}.`);
                    logBZDM(`----------- bCRM rBD: END LOG REFRESH EVENT TO HISTORY FOR [${symbol} ${endpointName}] -------------`);
                } catch (error: any) {
                    const durationMs = Date.now() - apiStart;
                    logBZDM(`bCRM rBD: ERROR refreshing ${symbol || '(no symbol)'} ${endpointName}:`, error.message);
                    // Log failure event
                    const historyPath = resolveRefreshHistoryPath(endpointName, symbol);
                    const nowDate = new Date();
                    const refreshEventId = getRefreshEventDocId(ApiProvider.BENZINGA, endpointName, nowDate, symbol);
                    await db.collection(historyPath).doc(refreshEventId).set({
                        timestamp: now,
                        status: 'failure',
                        durationMs,
                        error: error.message,
                        endpoint: endpointName,
                        symbol,
                        vendor: ApiProvider.BENZINGA,
                    });
                    logBZDM(`bCRM rBD: Logged failure event for ${symbol || '(no symbol)'} ${endpointName} as ${refreshEventId}.`);
                    logBZDM(`----------- bCRM rBD: END REFRESH FOR ${symbol} ${endpointName} -----------------------`);
                }
                logBZDM(`=========== END SYMBOL [${symbol}] ===================================`);
                logBZDM(`**********************************************************************************`);
                logBZDM(`-`);
                logBZDM(`-`);
            }
            logBZDM(`**********************************************************************************`);
            logBZDM(`**********************************************************************************`);
            logBZDM(`=========== END ENDPOINT [${endpointName}] ===================================`);
            logBZDM(`-`);
            logBZDM(`-`);
        }
        logBZDM(`rBZD: --- Benzinga Calendar Data Refresh Cycle Complete. Duration: ${Date.now() - batchStart}ms ---`);
        logBZDM('==============================================');
    }
);

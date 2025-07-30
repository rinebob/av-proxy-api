// =======================================
// DATA MANAGER: Benzinga Data Refresher
// =======================================

import { db } from '../../../firebase-admin-init';
import { Timestamp } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { FirestoreCollection } from '../../common/firestore/firestore-collections';
import { EndpointSymbolUsage } from '../../common/common-fn';

import { RefreshInfoService } from '../../services/refresh-info.service';
import { BenzingaHandlerFactory } from '../../benzinga/benzinga-factory';
import type { HandlerKey } from '../../benzinga/benzinga-factory';
import { BZ_CALENDAR_REQUEST_CONFIGS } from '../../benzinga/request-configs/bz-calendar-request-configs';
import { BZ_CALENDAR_REFRESH_SCHEDULE } from '../../common/function-schedules';
import { refreshLogger } from '../../services/refresh-logger.service';
import { ApiProvider } from '../../common/data-providers';

// Firestore utilities
import { 
  resolveFirestorePath
} from '../../utils/firestore-utils';
import { RefreshTrigger } from '../../common/refresh.types';

// Logging helper
const pr = true;
function logBZDM(message: string, ...args: any[]) {
    if (pr) console.log(`${message}`, ...args);
}

// Main logic for refreshing Benzinga data
export async function runBenzingaCalendarRefreshJob() {
    logBZDM('==============================================');
    logBZDM('--- bCRM rBD Benzinga Calendar Data Refresh Cycle Started ---');
    const batchStart = Date.now();

    // 1. Get all tracked symbols (assume a collection 'tracked-symbols' exists)
    const symbolsSnap = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
    const symbols = symbolsSnap.docs.map(doc => doc.id);
    logBZDM(`bCRM rBD: Found ${symbols.length} tracked symbols:`, symbols);

    // TODO: Remove this after debugging
    // 2. Combine company and market data requests
    const calendarRequests = { ...BZ_CALENDAR_REQUEST_CONFIGS };
    // const failingCalendarRequests = {
    //     [BZ_CALENDAR_REQUEST_CONFIGS.fda.id]: BZ_CALENDAR_REQUEST_CONFIGS.fda,
    //     [BZ_CALENDAR_REQUEST_CONFIGS.offerings.id]: BZ_CALENDAR_REQUEST_CONFIGS.offerings
    // };
    // const succeedingCalendarRequests = {
    //     [BZ_CALENDAR_REQUEST_CONFIGS.dividends.id]: BZ_CALENDAR_REQUEST_CONFIGS.dividends,
    //     [BZ_CALENDAR_REQUEST_CONFIGS.ipos.id]: BZ_CALENDAR_REQUEST_CONFIGS.ipos
    // };
    
    // 3. For each implemented Benzinga calendar endpoint
    for (const [endpointName, endpointConfig] of Object.entries(calendarRequests)) {
    // for (const [endpointName, endpointConfig] of Object.entries(succeedingCalendarRequests)) {

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
                if (!endpointConfig.firestorePath) {
                    logBZDM(`Skipping - no firestorePath configured for endpoint: ${endpointName}`);
                    continue;
                }
                docPath = resolveFirestorePath({
                  firestorePath: endpointConfig.firestorePath,
                  symbolUsage: endpointConfig.symbolUsage,
                  endpointName
                }, symbol);
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
            const requestId = `bzcrm-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            
            try {
                logBZDM(`----------- bCRM rBD: START API CALL FOR [${displayName} ${endpointName}] -------------`);
                logBZDM(`bCRM rBD: Refreshing ${displayName} ${endpointName} via Benzinga API...`);

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

                const apiResponse = await handler.handleRequest(apiParams, requestId);
                const durationMs = Date.now() - apiStart;
                logBZDM(`bCRM rBD: Fetched data for ${displayName} ${endpointName} in ${durationMs}ms.`);
                logBZDM(`----------- bCRM rBD: END API CALL FOR [${displayName} ${endpointName}] -------------`);

                // 5. Write to Firestore using the new RefreshInfoService
                logBZDM(`----------- bCRM rBD: START WRITE TO FIRESTORE FOR [${displayName} ${endpointName}] -------------`);
                await RefreshInfoService.updateDocumentWithRefreshInfo(
                    docRef,
                    apiResponse, // The actual data payload
                    {
                        status: 'SUCCESS',
                        durationMs,
                        triggeredBy: RefreshTrigger.SCHEDULER,
                        errorDetails: null,
                    },
                    {
                        ttlSeconds: ttl,
                        refreshedBy: endpointName,
                        nextRefreshBy: endpointName,
                    }
                );
                logBZDM(`bCRM rBD: Successfully wrote data for ${displayName} ${endpointName} to ${docPath}`);
                logBZDM(`----------- bCRM rBD: END WRITE TO FIRESTORE FOR [${displayName} ${endpointName}] -------------`);

                // --- Update symbol-data/<symbol> metadata fields ---
                if (requiresSymbol && symbol) {
                    // Centralized symbol doc metadata update
                    await refreshLogger.updateSymbolMetadata({
                        symbol,
                        endpointName,
                        now: new Date(),
                        ttl,
                    });
                    logBZDM(`bCRM rBD: Updated minimal metadata fields for symbol ${symbol}.`);

                    // Log the refresh event
                    await refreshLogger.logRefreshEvent(
                        {
                            vendor: ApiProvider.BENZINGA,
                            endpoint: endpointName,
                            symbol, // or undefined for global endpoint
                            ttlSeconds: ttl,
                        },
                        {
                            status: 'SUCCESS',
                            triggeredBy: RefreshTrigger.SCHEDULER,
                            refreshedBy: endpointName,
                            durationMs,
                            errorDetails: null,
                        }
                    );
                }

            } catch (error: any) {
                const durationMs = Date.now() - apiStart;
                const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
                logBZDM(`bCRM rBD: [ERROR] Failed to refresh data for ${displayName} ${endpointName}:`, errorMessage);

                // Log the failure using the new RefreshInfoService
                logBZDM(`----------- bCRM rBD: START LOGGING FAILURE FOR [${displayName} ${endpointName}] -------------`);
                await RefreshInfoService.updateDocumentWithRefreshInfo(
                    docRef,
                    null, // No data to save on failure
                    {
                        status: 'FAILURE',
                        durationMs,
                        triggeredBy: RefreshTrigger.SCHEDULER,
                        errorDetails: errorMessage,
                    },
                    {
                        ttlSeconds: ttl,
                        refreshedBy: endpointName,
                        nextRefreshBy: endpointName,
                    }
                );
                logBZDM(`bCRM rBD: Successfully logged failure for ${displayName} ${endpointName} to ${docPath}`);
                logBZDM(`----------- bCRM rBD: END LOGGING FAILURE FOR [${displayName} ${endpointName}] -------------`);
            }
            logBZDM(`=========== END ${requiresSymbol ? 'SYMBOL' : 'MARKET DATA'} [${displayName} ${endpointName}] ===================================`);
        }
        logBZDM(`=========== END ENDPOINT [${endpointName}] ===================================`);
    }

    const batchEnd = Date.now();
    logBZDM(`--- bCRM rBD: Benzinga Calendar Data Refresh Cycle Finished in ${batchEnd - batchStart}ms ---`);
    logBZDM('==============================================');
}

// Main scheduled function for refreshing Benzinga data
export const refreshBenzingaCalendarDataV2 = onSchedule(
    {
        schedule: BZ_CALENDAR_REFRESH_SCHEDULE,
        timeZone: 'America/Los_Angeles', // Explicit timezone for the schedule
        secrets: ['BENZINGA_CALENDAR_API_KEY'],
    },
    async () => {
        await runBenzingaCalendarRefreshJob();
    }
);

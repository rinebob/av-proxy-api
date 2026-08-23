/**
 * Verification script for Task #39 — Config changes for earnings endpoints.
 *
 * Confirms that the AV_ENDPOINT_CONFIGS and AV_IMPLEMENTED_ENDPOINTS are correct
 * at runtime: TTL values, firestorePaths, symbolUsage, horizon parameter, and
 * implemented endpoint set membership.
 *
 * Usage: npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/earnings-39-config-changes.ts
 */
import { AV_ENDPOINT_CONFIGS } from '@shared/alpha-vantage/av-endpoint-configs';
import { AlphaVantageEndpoint, AV_IMPLEMENTED_ENDPOINTS } from '@shared/alpha-vantage/av-endpoints';
import { EndpointSymbolUsage } from '@shared/core/types';
import { FirestoreCollection } from '@shared/firestore/firestore';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error('FAIL: ' + message);
    process.exit(1);
  }
  console.log('PASS: ' + message);
}

console.log('--- Verifying EARNINGS config ---');

const earningsConfig = AV_ENDPOINT_CONFIGS[AlphaVantageEndpoint.EARNINGS];
assert(earningsConfig !== undefined, 'EARNINGS config exists');
assert(earningsConfig!.ttl === 7 * 24 * 60 * 60, 'EARNINGS TTL is 7 days (got ' + earningsConfig!.ttl + ')');
assert(earningsConfig!.ttl !== 30 * 24 * 60 * 60, 'EARNINGS TTL is NOT 30 days');
assert(earningsConfig!.symbolUsage === EndpointSymbolUsage.REQUIRED, 'EARNINGS symbolUsage is REQUIRED');
assert(
  earningsConfig!.firestorePath === FirestoreCollection.SYMBOL_DATA + '/{symbol}/' + FirestoreCollection.EARNINGS + '/av-' + FirestoreCollection.EARNINGS,
  'EARNINGS firestorePath correct (got ' + earningsConfig!.firestorePath + ')',
);

console.log('\n--- Verifying EARNINGS_ESTIMATES config ---');

const estimatesConfig = AV_ENDPOINT_CONFIGS[AlphaVantageEndpoint.EARNINGS_ESTIMATES];
assert(estimatesConfig !== undefined, 'EARNINGS_ESTIMATES config exists');
assert(estimatesConfig!.ttl === 7 * 24 * 60 * 60, 'EARNINGS_ESTIMATES TTL is 7 days (got ' + estimatesConfig!.ttl + ')');
assert(estimatesConfig!.symbolUsage === EndpointSymbolUsage.REQUIRED, 'EARNINGS_ESTIMATES symbolUsage is REQUIRED');
const estimatesPath = estimatesConfig!.firestorePath ?? '';
assert(
  estimatesPath === FirestoreCollection.SYMBOL_DATA + '/{symbol}/' + FirestoreCollection.EARNINGS + '/av-' + FirestoreCollection.EARNINGS_ESTIMATES,
  'EARNINGS_ESTIMATES firestorePath grouped under earnings/ (got ' + estimatesPath + ')',
);
assert(
  !estimatesPath.includes(FirestoreCollection.EARNINGS_ESTIMATES + '/av-'),
  'EARNINGS_ESTIMATES firestorePath does NOT use old standalone earnings-estimates/ path',
);

console.log('\n--- Verifying EARNINGS_CALENDAR config ---');

const calendarConfig = AV_ENDPOINT_CONFIGS[AlphaVantageEndpoint.EARNINGS_CALENDAR];
assert(calendarConfig !== undefined, 'EARNINGS_CALENDAR config exists');
assert(
  calendarConfig!.symbolUsage === EndpointSymbolUsage.OPTIONAL,
  'EARNINGS_CALENDAR symbolUsage is OPTIONAL (got ' + calendarConfig!.symbolUsage + ')',
);
const calendarPath = calendarConfig!.firestorePath ?? '';
assert(
  calendarPath === FirestoreCollection.MARKET_DATA + '/av-' + FirestoreCollection.EARNINGS_CALENDAR,
  'EARNINGS_CALENDAR firestorePath is global market-data path (got ' + calendarPath + ')',
);
assert(!calendarPath.includes('{symbol}'), 'EARNINGS_CALENDAR firestorePath has no {symbol}');
assert(calendarConfig!.ttl === 24 * 60 * 60, 'EARNINGS_CALENDAR TTL is 1 day (got ' + calendarConfig!.ttl + ')');

const symbolParam = calendarConfig!.parameters?.symbol as { type: string; required: boolean } | undefined;
assert(symbolParam !== undefined, 'EARNINGS_CALENDAR has symbol parameter');
assert(symbolParam!.required === false, 'EARNINGS_CALENDAR symbol parameter is optional (not required)');

const horizonParam = calendarConfig!.parameters?.horizon as { type: string; required: boolean; default?: string; enum?: string[] } | undefined;
assert(horizonParam !== undefined, 'EARNINGS_CALENDAR has horizon parameter');
assert(horizonParam!.default === '12month', 'EARNINGS_CALENDAR horizon default is 12month (got ' + horizonParam!.default + ')');
assert(
  horizonParam!.enum?.length === 3 && horizonParam!.enum.includes('3month') && horizonParam!.enum.includes('6month') && horizonParam!.enum.includes('12month'),
  'EARNINGS_CALENDAR horizon has enum constraint (got ' + JSON.stringify(horizonParam!.enum) + ')',
);

console.log('\n--- Verifying AV_IMPLEMENTED_ENDPOINTS ---');

assert(AV_IMPLEMENTED_ENDPOINTS.has(AlphaVantageEndpoint.EARNINGS), 'AV_IMPLEMENTED_ENDPOINTS includes EARNINGS');
assert(AV_IMPLEMENTED_ENDPOINTS.has(AlphaVantageEndpoint.EARNINGS_ESTIMATES), 'AV_IMPLEMENTED_ENDPOINTS includes EARNINGS_ESTIMATES');
assert(AV_IMPLEMENTED_ENDPOINTS.has(AlphaVantageEndpoint.EARNINGS_CALENDAR), 'AV_IMPLEMENTED_ENDPOINTS includes EARNINGS_CALENDAR');

console.log('\n=== All verification checks passed ===');

import { AlphaVantageEndpoint } from './av-endpoints';

/**
 * Consumer-facing endpoint identity for the Savant API.
 *
 * Distinct from AlphaVantageEndpoint (which uses raw AV function names).
 * The SA- enum is our internal identity layer — multiple SA endpoints can
 * derive from the same AV call / Firestore doc (e.g., per-symbol and global
 * calendar views both derive from one AV EARNINGS_CALENDAR call).
 */
export enum SavantApiEndpoint {
  SA_EARNINGS                  = 'SA_EARNINGS',
  SA_EARNINGS_ESTIMATES        = 'SA_EARNINGS_ESTIMATES',
  SA_EARNINGS_CALENDAR         = 'SA_EARNINGS_CALENDAR',
  SA_EARNINGS_CALENDAR_GLOBAL  = 'SA_EARNINGS_CALENDAR_GLOBAL',
}

/**
 * Maps each SA endpoint to the AV function it calls (or derives from).
 * Two SA endpoints can map to the same AV function — that's the per-symbol/global split.
 */
export const SA_ENDPOINT_TO_AV_FUNCTION: Record<SavantApiEndpoint, AlphaVantageEndpoint> = {
  [SavantApiEndpoint.SA_EARNINGS]:                  AlphaVantageEndpoint.EARNINGS,
  [SavantApiEndpoint.SA_EARNINGS_ESTIMATES]:        AlphaVantageEndpoint.EARNINGS_ESTIMATES,
  [SavantApiEndpoint.SA_EARNINGS_CALENDAR]:         AlphaVantageEndpoint.EARNINGS_CALENDAR,
  [SavantApiEndpoint.SA_EARNINGS_CALENDAR_GLOBAL]:  AlphaVantageEndpoint.EARNINGS_CALENDAR,
};

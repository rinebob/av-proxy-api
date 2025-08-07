// COPIED FROM functions/src/v2/common/common-benz.ts. Do not use directly until migration is complete.

/**
 * Base interface for all Benzinga calendar items.
 */
export interface BenzingaCalendarItemBase {
  id: string;
  date: string;
  time: string;
  time_updated: string;
  date_updated: string;
  ticker: string;
  name: string;
  exchange: string;
}

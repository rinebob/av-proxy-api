// COPIED FROM src/app/feat/bz-calendar-view/common/fe-common-bz-api.ts. Do not use directly until migration is complete.

/**
 * Stock splits data structure
 */
export interface BzSplitsData {
  date: string;
  ticker: string;
  name: string;
  exchange: string;
  ratio: number;
  split_date: string;
  updated: number;
  importance?: number;
  notes?: string;
}

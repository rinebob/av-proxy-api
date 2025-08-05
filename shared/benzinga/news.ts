// COPIED FROM src/app/feat/bz-calendar-view/common/fe-common-bz-api.ts. Do not use directly until migration is complete.

/**
 * News data structure
 */
export interface NewsData {
  id: string;
  title: string;
  url: string;
  summary: string;
  content: string;
  created_at: string;
  updated_at: string;
  published_at: string;
  tickers: string[];
  tags: string[];
  channels: string[];
  source: string;
  author: string;
  image_url: string;
  related_assets: string[];
}

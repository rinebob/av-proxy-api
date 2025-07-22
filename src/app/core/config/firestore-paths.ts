import { FirestoreCollection } from './firestore-collection-enum';
import { BzNewsChannel } from '../../common/bz-news-channels';

export enum COMPANY_DATA_COLLECTION {
  COMPANY_OVERVIEW = 'company-overview',
  CONFERENCE_CALLS = 'conference-calls',
  DIVIDENDS = 'dividends',
  EARNINGS = 'earnings',
  GUIDANCE = 'guidance',
  OFFERINGS = 'offerings',
  RATINGS = 'ratings',
  SPLITS = 'splits',
}

export enum ECONOMICS_COLLECTION {
  ECONOMIC_CALENDAR = 'economic-calendar',
}

export enum MARKET_DATA_COLLECTION {
  FDA = 'fda',
  IPOS = 'ipos',
  MERGERS_ACQUISITIONS = 'mergers-acquisitions',
}

export enum NEWS_COLLECTION {
  BENZINGA = 'benzinga',
}

// Keep only the basic path configurations that might still be used for reference
export const FirestorePathHelper = {
  // This can be used as a reference for valid collection names
  getCollectionNames(): string[] {
    return [
      ...Object.values(COMPANY_DATA_COLLECTION),
      ...Object.values(MARKET_DATA_COLLECTION),
      ...Object.values(ECONOMICS_COLLECTION),
      ...Object.values(NEWS_COLLECTION),
    ];
  },
  
  // Helper to validate if a collection name is valid
  isValidCollectionName(name: string): boolean {
    return this.getCollectionNames().includes(name);
  },
  
  // Helper to get all news channel names
  getNewsChannelNames(): string[] {
    return Object.values(BzNewsChannel);
  },
  
  // Helper to check if a name is a valid news channel
  isValidNewsChannel(name: string): boolean {
    return this.getNewsChannelNames().includes(name);
  }
};
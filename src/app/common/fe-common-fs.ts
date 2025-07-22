import { FirestoreCollection } from "../core/config/firestore-collection-enum";


export interface FirestoreDocument {
    id: string;
    data: any;
    path: string;
}

export interface CollectionInfo {
    id: string;
    name: string;
    description: string;
    isSubcollection?: boolean;
}

export const TOP_LEVEL_COLLECTIONS: CollectionInfo[] = [
    { 
      id: FirestoreCollection.COMPANY_DATA, 
      name: 'Company Data', 
      description: 'Company information and metrics',
      isSubcollection: false
    },
    { 
      id: FirestoreCollection.MARKET_DATA, 
      name: 'Market Data', 
      description: 'Market prices and trading data',
      isSubcollection: false
    },
    { 
      id: FirestoreCollection.NEWS, 
      name: 'News', 
      description: 'News articles and updates',
      isSubcollection: false
    },
    { 
      id: FirestoreCollection.ECONOMICS, 
      name: 'Economics', 
      description: 'Economic data and metrics',
      isSubcollection: false
    },
    { 
      id: FirestoreCollection.TIME_SERIES, 
      name: 'Time Series', 
      description: 'Time series data',
      isSubcollection: false
    },
    { 
      id: FirestoreCollection.TRACKED_SYMBOLS, 
      name: 'Tracked Symbols', 
      description: 'Symbols being tracked in the system',
      isSubcollection: false
    }
];
// Centralized Firestore collection name constants for backend functions
// Extend this enum as new collections are added

export enum FirestoreCollection {
  // Symbol Management Collections
  TRACKED_SYMBOLS = "tracked-symbols",
  COMPANY_DATA = "company-data",
  
  // Market Data Collections
  MARKET_DATA = "market-data",
  DATA_POINTS = "data-points",
  
  // Refresh Tracking
  REFRESH_EVENTS = "refresh-events",
  REFRESH_HISTORY = "refresh-history"
}

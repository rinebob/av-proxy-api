// Centralized Firestore collection name constants for backend functions
// Extend this enum as new collections are added

export enum FirestoreCollection {
  // Symbol Management Collections
  TRACKED_SYMBOLS = "tracked_symbols",

  // Market Data Collections
  MARKET_DATA = "market_data",
  DATA_POINTS = "data_points",

  // Refresh Tracking
  REFRESH_EVENTS = "refresh_events",
  REFRESH_HISTORY = "refresh_history"
}

// Legacy string constants (deprecated - use the enum above)
/** @deprecated Use FirestoreCollection enum instead */
export const TRACKED_SYMBOLS = FirestoreCollection.TRACKED_SYMBOLS;
/** @deprecated Use FirestoreCollection enum instead */
export const MARKET_DATA = FirestoreCollection.MARKET_DATA;
/** @deprecated Use FirestoreCollection enum instead */
export const DATA_POINTS = FirestoreCollection.DATA_POINTS;
/** @deprecated Use FirestoreCollection enum instead */
export const REFRESH_EVENTS = FirestoreCollection.REFRESH_EVENTS;
/** @deprecated Use FirestoreCollection enum instead */
export const REFRESH_HISTORY = FirestoreCollection.REFRESH_HISTORY;

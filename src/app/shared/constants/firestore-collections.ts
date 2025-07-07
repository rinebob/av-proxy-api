/**
 * Centralized Firestore collection names for the application.
 * 
 * Note: These should match the collection names used in the backend.
 * Any changes to these names should be coordinated with backend updates.
 */

export const FirestoreCollections = {
  /** Collection for tracked stock symbols */
  TRACKED_SYMBOLS: 'tracked-symbols',
  
  /** Collection for market data */
  MARKET_DATA: 'market-data',
  
  /** Subcollection for refresh events under each symbol */
  REFRESH_EVENTS: 'refresh-events',
  
  /** Subcollection for refresh history under each symbol */
  REFRESH_HISTORY: 'refresh-history',
  
  /** Collection for system settings */
  SETTINGS: 'settings',
  
  /** Collection for user-specific data */
  USERS: 'users'
} as const;

/**
 * Type for valid Firestore collection names
 */
export type FirestoreCollectionName = 
  | typeof FirestoreCollections.TRACKED_SYMBOLS
  | typeof FirestoreCollections.MARKET_DATA
  | typeof FirestoreCollections.REFRESH_EVENTS
  | typeof FirestoreCollections.REFRESH_HISTORY
  | typeof FirestoreCollections.SETTINGS
  | typeof FirestoreCollections.USERS;

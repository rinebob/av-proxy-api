# Firestore Schema: Data Maintainer Service

## tracked_symbols (Collection)
- **Document ID:** Symbol (e.g., AAPL)
- **Fields:**
  - `symbol`: string
  - `dateAdded`: Firestore Timestamp
  - `isActive`: boolean
  - `sources`: string[] (list of client app IDs)

## market_data (Collection)
- **Document ID:** Symbol (e.g., AAPL)
- **Subcollection:** data_points
  - **Document ID:** Endpoint name (e.g., GLOBAL_QUOTE)
  - **Fields:**
    - `endpoint`: string
    - `lastUpdated`: Firestore Timestamp
    - `nextRefreshAt`: Firestore Timestamp
    - `ttlSeconds`: number
    - `status`: "SUCCESS" | "FETCH_ERROR" | "PENDING_FIRST_FETCH"
    - `data`: object (API payload)
    - `errorDetails`: object|null

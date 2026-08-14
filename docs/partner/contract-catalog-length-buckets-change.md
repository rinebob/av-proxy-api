# Contract Catalog: `lengthBuckets` Response Shape Change

## Summary

The `lengthBuckets` field in the `partnerContractCatalogV2` summary response is changing from a **JSON object** (`Record<string, number>`) to a **JSON array** of objects, each with a `label`, `count`, and `sortOrder`. This fixes incorrect bucket ordering and gives consumers a reliable, self-contained way to sort buckets by contract length.

## Timeline

This change is **pre-release**. The `partnerContractCatalogV2` endpoint has not been announced to partners yet, so no migration window is required. If you are already consuming this endpoint during pilot, update your integration before the next deploy.

## Current Shape (Before)

```json
{
  "ok": true,
  "symbol": "QQQ",
  "totalContracts": 250000,
  "expirationCount": 185,
  "lengthBuckets": {
    "1d": 2738,
    "3d": 7584,
    "1mo": 14214,
    "1yr": 9136,
    "2mo": 52236
  },
  "lastUpdated": "2026-07-29T16:00:00Z"
}
```

**Problems:**
- JSON object keys have no guaranteed order. Consumers cannot rely on iteration order.
- Lexicographic key sort produces wrong chronological order (`1d` < `1mo` < `1yr` < `2mo` < `3d`).
- No way for a consumer to sort a filtered subset of buckets without external knowledge of the bucket ordering.

## New Shape (After)

```json
{
  "ok": true,
  "symbol": "QQQ",
  "totalContracts": 250000,
  "expirationCount": 185,
  "lengthBuckets": [
    { "label": "1d",    "count": 2738,   "sortOrder": 0 },
    { "label": "3d",    "count": 7584,   "sortOrder": 1 },
    { "label": "5d",    "count": 6684,   "sortOrder": 2 },
    { "label": "7d",    "count": 11606,  "sortOrder": 3 },
    { "label": "14d",   "count": 143210, "sortOrder": 4 },
    { "label": "21d",   "count": 47802,  "sortOrder": 5 },
    { "label": "1mo",   "count": 14214,  "sortOrder": 6 },
    { "label": "1.5mo", "count": 35302,  "sortOrder": 7 },
    { "label": "2mo",   "count": 52236,  "sortOrder": 8 },
    { "label": "3mo",   "count": 5020,   "sortOrder": 9 },
    { "label": "4mo",   "count": 9432,   "sortOrder": 10 },
    { "label": "6mo",   "count": 6828,   "sortOrder": 11 },
    { "label": "9mo",   "count": 6418,   "sortOrder": 12 },
    { "label": "1yr",   "count": 9136,   "sortOrder": 13 },
    { "label": "2yr",   "count": 6942,   "sortOrder": 14 },
    { "label": "3yr",   "count": 4658,   "sortOrder": 15 }
  ],
  "lastUpdated": "2026-07-29T16:00:00Z"
}
```

## Field Reference

Each entry in the `lengthBuckets` array:

| Field       | Type     | Description                                                        |
| :---------- | :------- | :----------------------------------------------------------------- |
| `label`     | `string` | Human-readable bucket label (e.g. `"3mo"`, `"1yr"`).              |
| `count`     | `number` | Number of contracts in this bucket.                               |
| `sortOrder` | `number` | Zero-based chronological position. Lower = shorter contract length. Use this to sort buckets on the client side. |

## What Consumers Must Do

1. **Change access pattern.** Replace object key lookups with array iteration or find-by-label:

   **Before:**
   ```typescript
   const count = response.lengthBuckets['3mo'] ?? 0;
   ```

   **After:**
   ```typescript
   const bucket = response.lengthBuckets.find(b => b.label === '3mo');
   const count = bucket?.count ?? 0;
   ```

2. **Use `sortOrder` for any client-side sorting.** If you filter or reorder the bucket list in your UI, sort by `sortOrder` ascending to restore chronological order:

   ```typescript
   const sorted = [...filteredBuckets].sort((a, b) => a.sortOrder - b.sortOrder);
   ```

3. **Iterate the array directly for display.** The array arrives pre-sorted by `sortOrder`, so if you don't filter or reorder, you can iterate as-is.

4. **No changes to query parameters.** The `contractLengthBucket` query filter still accepts comma-separated labels (e.g. `?contractLengthBucket=3mo,6mo,1yr`). That interface is unchanged.

## Bucket Definitions

For reference, here are all valid bucket labels and their calendar-day ranges:

| Label    | Sort Order | Calendar Days (inclusive upper bound) |
| :------- | :--------- | :------------------------------------ |
| `1d`     | 0          | 1                                     |
| `3d`     | 1          | 3                                     |
| `5d`     | 2          | 5                                     |
| `7d`     | 3          | 7                                     |
| `14d`    | 4          | 14                                    |
| `21d`    | 5          | 21                                    |
| `1mo`    | 6          | 31                                    |
| `1.5mo`  | 7          | 42                                    |
| `2mo`    | 8          | 60                                    |
| `3mo`    | 9          | 91                                    |
| `4mo`    | 10         | 122                                   |
| `6mo`    | 11         | 183                                   |
| `9mo`    | 12         | 274                                   |
| `1yr`    | 13         | 365                                   |
| `2yr`    | 14         | 730                                   |
| `3yr`    | 15         | (no upper bound)                      |

Buckets with zero contracts are omitted from the response array. Do not assume every bucket is present.

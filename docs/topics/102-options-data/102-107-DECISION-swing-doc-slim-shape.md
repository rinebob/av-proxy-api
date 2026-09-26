**Topic:** Swing-driven options corpus platform
**Thread:** Endpoint contract (#107)
**Type:** DECISION
**Status:** Accepted
**Created:** 2026-09-25

# Decision: swing-set docs are a corpus date-sampler, not a served artifact

## Context

The corpus needs option-chain snapshots at swing extremes — the dates where
price amplitude is fully expressed — so contract time series carry the true
range of moneyness/stop-level movement rather than hidden breaches.

Early design assumed SA would persist full swing analyses (`pivots[]`,
`swings[]`, `stats`) under four canonical zigzag configs and serve them to ST.
Two facts killed that:

1. **ST computes the full zigzag client-side** from its own bars via the
   shared engine — nothing needs server-computed arrays.
2. **The arrays scale with history** (~1.5–2 MB/doc on long-history symbols),
   pressing against Firestore's 1 MiB cap.

And once the purpose narrowed to corpus *date sampling*, the multi-config
machinery became dead weight: a finer config's pivot set contains every
coarser config's extremes.

## Decision

- **One swing-set doc per enabled symbol**, generated under
  `CORPUS_ZIGZAG_CONFIG` (dev2/L2/R2 — the finest config; its pivot dates
  cover every ≥2% extreme, i.e. all larger swings' extremes too).
- **Doc stores only the extraction output + freshness metadata:**

```ts
{
  symbol, paramsId, config,
  pivotDates: string[],               // confirmed extreme dates, YYYY-MM-DD
  currentExtremeDate: string | null,  // developing swing's extreme
  currentDirection: 'up' | 'down' | null,
  generatedAt, source: 'sa' | 'st',
}
```

- `pivots`/`swings`/`stats`/`projection` fields are **gone**; `upsert` is a
  full (non-merge) `set` so regeneration wipes stale fields.
- **`partnerSwingSetsV2` is removed** — there is no served artifact; ST keeps
  its existing implementation and reads nothing from SA's swing collection.

## What this means for ST

- **ST does not read swing data from SA at all.** Pivots, swings, stats, and
  projection are computed locally via the shared engine on ST's own bars.
- SA's `options-swing-sets` collection is internal-only — it exists solely to
  feed the corpus planner's date selection (`planPivotSeeds`).

## Consequences

- ~10–50 KB per doc (dates only) — the 1 MiB cap is a non-issue permanently.
- `planPivotSeeds` reads one doc per symbol instead of four.
- Swing data is now merely a **curation heuristic** — "which dates deserve
  chain snapshots" — chosen because extremes carry full price amplitude.
  If a different sampling rule is ever better (e.g., uniform calendar), the
  planner is the only consumer to change.


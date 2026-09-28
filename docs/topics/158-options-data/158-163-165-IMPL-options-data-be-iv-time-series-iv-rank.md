**Topic:** IV time series  
**Topic Slug:** iv-time-series  
**Thread:** IV rank  
**Thread Slug:** iv-rank  
**Issue:** #165  
**Thread Parent:** #163  
**Topic Parent:** #158  
**Domain:** OPTIONS-DATA  
**Type:** IMPL (BE)  
**Status:** Approved  
**Created:** 2026-09-27  
**Last Updated:** 2026-09-27  

# IMPL (BE) — IV rank pipeline + screener endpoint

## Data flow

```text
seedCorpusItem → computeForDate (iv30 lands on day entry)
              → rankPass(symbol, date):                  # NEW — second pass
                  1. read trailing IV30 rows over max-window (360 cal days)
                     = readYear docs for current + prior year, slice days
                  2. rank computers → ivRank{W}/ivPct{W}/ivN{W}
                  3. repo.mergeFields write onto the same day entry
                  4. if date == symbol's newest day entry → upsert
                     iv-rank-latest/{SYM}
```

Latest-only freshness: historical rank fields freeze at write; only the
newest date rewrites `iv-rank-latest`. Disable → `iv-rank-latest` doc delete
(hook `setOptionsEnabledV2` false-transition or the sweep).

## Computers (`v2/symbol-metrics/rank/`)

Pure functions `(iv30Series: {date, iv30}[], asOf: string, W) →
{ivRank, ivPct, n}`:

- window = rows with `asOf - W days ≤ date ≤ asOf` (calendar)
- `ivRank = (cur − min)/(max − min) · 100` (n<2 → omit field, n still emitted)
- `ivPct = count(iv ≤ cur)/n · 100`
- constant series (max==min) → rank 0; empty window → omit all

## RankBuildService

`computeRankForDate(symbol, date)` — reads `repo.readYear` for the ≤2 year
docs covering `date - 360d … date`; returns `{symbol, date, written, fields}`
mirroring MetricBuildResult. Warn-not-fail under the seed hook (same
swallow semantics as Task #171).

## Seed hook

Extend the Task #171 `metrics` seam in `corpus-seed.worker.ts` (or the task
handler) to call the rank pass after `computeForDate` — same confirmed-
present paths, same warn-swallow. Re-seeding heals both.

## partnerIvRankV2

`GET ?sort=ivPct360&minN=20&dir=desc` over `iv-rank-latest` — single
collection scan; rows = flat docs; sort param whitelist =
rank field names. Same dual-auth/envelope conventions as the other partner
endpoints.

## Tasks

1. Rank computers + unit tests (pure)
2. RankBuildService + iv-rank-latest repository + day-entry merge write
3. Seed hook + disable-cleanup (delete latest doc)
4. partnerIvRankV2 endpoint + tests
5. Prod verify script (extends #173 script: rank fields on rows + table endpoint)

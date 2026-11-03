**Topic:** Options Corpus Bulk Ingest  
**Topic Slug:** options-data  
**Thread:** Full-Date Corpus Backfill (2026)  
**Thread Slug:** corpus-backfill-2026  
**Issue:** #218  
**Thread Parent:** #214  
**Topic Parent:** #213  
**Task:** #227  
**Domain:** BE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-01  
**Last Updated:** 2026-11-01  

## Verdict: **PASS** (after three remediation passes)

Three review passes ran against the working-tree change set (diff vs HEAD;
new files read whole). Pass 2 found one **major** — a pre-existing broken
GCS conditional write this feature's docs claim as a guarantee. Pass 3
found one new minor (a confirmed-without-flag dead end) plus convergent
nits; all remediated below. No residual critical/major findings.

## Third pass (2026-11-02) — re-review of pass-2 remediation

Three axes re-ran on final-state code, reporting only new findings.

### Remediated findings (pass 3)

- **minor → fixed** — `markChainConfirmed` stamped `chainFlagConfirmed`
  with no `chainFlag` when a stray/manual `forceRefetch` hit an unstamped
  suspect (the exact pre-#227 population the stamp pass exists for): the
  object then escaped both reconciler buckets — never re-seeded, never
  logged as a thin chain. `markChainConfirmed(symbol, date, flag)` now
  stamps the refetched flag alongside the confirmed mark (also closes
  the pass-2 accepted flag-stamp-drift nit — the stamp now reflects the
  latest refetch). New adapter test pins the unstamped-object case.
- minor → fixed — verify-script probes could pick a live-queued date and
  FAIL on a healthy pipeline (flagged by two axes): probe candidates now
  also exclude dates with live pending/in_progress run items.
- nit → fixed — reconcile core header still said "item docs = dispatched
  gaps only" — updated for flagged suspects.
- nit → fixed — `nightly-corpus.service.ts` + `pilot.service.ts` inline
  `{s}_{d}` key copies swapped to `corpusItemKey` — one implementation of
  the doc-key format remains (pilot's were in-memory only; nightly's
  feeds real Firestore doc ids).
- nit → fixed — adapter-test fake bucket diverged from GCS listing
  semantics: `getFiles` now honors `prefix` and omits never-written
  (phantom `bucket.file()` handles); `setMetadata` 404s on missing
  objects. Prevents latent false-positives in future multi-symbol /
  list-after-miss tests.

### Accepted (pass 3)

- gcs-hit short-circuit of a confirmed `forceRefetch` logs
  `seed.skip.gcs-hit` and writes a flagless item doc (vs the confirm
  path's `chainFlagConfirmed` doc) — two routes to "already confirmed"
  record different item shapes; observability-only, the doc records what
  this seed did.
- `markChainConfirmed` then a `recordPresentAndFanout` throw leaves the
  item `permanent_failure` on a confirmed-present object — ordering is
  the right direction (fanout-first risks refetch-forever); residual is
  cosmetic and bounded to that run doc.
- The two `storedMetadata→details` literals (gcs-hit vs chain-confirmed)
  share ~4 fields verbatim — inline keeps the `apiCalls`/`chain` deltas
  legible per call site.
- Fake `getFiles` could still return objects from other symbols when a
  test doesn't scope the prefix — the adapter always passes one.
- Unrelated `#211` verify-README row rides along in this diff — sibling
  session's staged change, internally consistent; not #227's to untangle.

## Second pass (2026-11-01) — re-review of post-remediation state

Three axes re-ran, scoped to report only new findings vs this doc.

### Remediated findings (pass 2)

- **MAJOR → fixed** — `writeItem` passed `ifGenerationMatch: 0` as a
  top-level `file.save()` option under an `as any` cast. The installed
  `@google-cloud/storage@7.x` only honors `preconditionOpts.{
  ifGenerationMatch}` (`startSimpleUpload_` merges it into `qs`); the
  top-level key is silently dropped, so the write was **unconditional**
  and the `alreadyExists`/412 branch dead in production. Pre-existing
  from `ca2442d` (#154), but it falsified the write-once guarantee this
  task's design rests on. Fixed to `preconditionOpts`, cast removed;
  the fake bucket now enforces the precondition and a new test proves a
  second write 412s into `alreadyExists` instead of overwriting.
- minor → fixed — probe injection could pick a non-trading-day object
  and FAIL on a healthy pipeline: candidates now intersect the trading
  calendar; a `no probe date` FAIL is documented as "re-run with a
  different `--symbols`".
- minor → fixed — `thinChains` derived by subtraction
  (`suspect − unconfirmed`); now counts the `confirmed` array directly.
- minor → fixed — live-queue suppression duplicated between the gaps
  and unconfirmed-flagged loops; shared `tryDispatch` closure.
- minor → fixed — `forced` map keyed by a 4th inline copy of the
  itemKey format; shared `corpusItemKey()` exported from `types.ts`
  (worker + metadata service private copies also swapped) and stores
  `kind ?? null` — single lookup, no `has()`+`get()` dance.
- minor → fixed — reconcile core type-coupled to the concrete adapter:
  `GcsCorpusObjectRef` moved to `types.ts` as domain `CorpusObjectRef`
  (adapter, coverage, pivot-fanout, tests updated).
- minor → fixed — `setItemSuccess` `chain`→doc-field flatten was
  untested; two new tests pin `putCount`/`callCount`/`rowCount`/
  `chainFlag`/`chainFlagConfirmed` on the doc.
- nit → fixed — `recordPresentAndFanout` 6 positional params →
  `(deps, payload, details)` (runId/symbol/date/key all derivable).
- nit → fixed — `--stamp-flags` post-check re-listed only `symbols[0]`;
  now verifies every stamped drift object across all symbols.
- nit → fixed — `drySink.plans` dead accumulator dropped; duplicate
  `corpus-metadata.service` imports merged.
- nit → fixed — stale `chainConfirmed` name in the verify guide +
  README; stale payload description in the #220 guide.

### Accepted (pass 2)

- `thinChains` as a third synonym (suspect → flagged → thin) — the term
  is documented wherever it appears; a rename would churn counters +
  run-doc fields for a marginal gain.
- `services/index.ts` barrel omits `chain-sanity`/`corpus-reconcile.core`
  — already non-exhaustive (several services unexported); all consumers
  import by path. Consistency-only nit.
- Coverage report classifies flagged dates as plain `seeded` — suspect
  state invisible on that read-only surface. Not required by the ACs
  (flags surface on run items + logs, per spec); flagged as a possible
  follow-up if operators triage via the coverage endpoint.



### Axis summary

- **Standards** — no hard violations of documented standards. One
  guideline flag (worker crossed the ~300-line target at 311) and
  judgement-call smells; the contract baseline (GCS `setMetadata`
  key-merge semantics, task-payload flow `enqueue → req.data → worker`)
  verified clean against real SDK behavior.
- **Spec** — all five acceptance criteria implemented; all architectural
  constraints preserved (chain counted in-memory, immutable objects
  handled via explicit stamps/delete+write, gate/retry/queue/fanout
  untouched). Two wording-level deviations noted and accepted below.
- **Thermo-nuclear** — full feature path traced (reconcile → payload →
  worker → GCS stamps → next sweep) plus contract matrix across GCS
  metadata / Firestore item / run-doc counters. One **major**, remediated
  in this pass; the rest minors/nits, remediated or accepted.

### Remediated findings

- **MAJOR → fixed** — quadrupled success tail in `corpus-seed.worker.ts`
  (`setItemSuccess → incrementCompleted → notifySeedSuccess →
  computeSymbolMetrics` ×3): extracted `recordPresentAndFanout` so the
  next post-success seam wires into one place — the same class of silent
  asymmetry this task exists to heal.
- minor → fixed — verify headline check passed vacuously (`forced=0`
  with no stamped suspects): dry-run now injects one unconfirmed +
  one confirmed probe ref into `listObjects` — forceRefetch dispatch and
  thin-chain counting are proven against real deps, non-vacuously.
- minor → fixed — one concept, two names: GCS-side `chainConfirmed`
  renamed to `chainFlagConfirmed` (object metadata key, `GcsCorpusObjectRef`,
  `GcsCorpusMetadata`, core/tests/script) — free rename, zero prod objects
  stamped yet. `thinChains` retained as the counter name (it counts, not
  marks).
- minor → fixed — forceRefetch on an already-confirmed object refetched
  forever on stray/manual dispatches: `GcsCorpusMetadata` now projects
  `chainFlagConfirmed` and the worker short-circuits to the gcs-hit path.
  New unit test pins it.
- nit → fixed — stale `listItems` docstring (`{date, kind}` →
  `{date, kind, chainFlag, chainFlagConfirmed}`).
- nit → fixed — `setItemSuccess` details bag at 10 loose fields →
  `chain?: ChainSanity` (the shape the worker already holds) +
  `chainFlagConfirmed`.
- nit → fixed — `covered` was a `Map` used only for `.has()` → `Set`.

### Accepted (documented, no action)

- **Spec-wording deviation** — flagged dates count as `present` (the
  object exists) and surface via `flagged`, not `missing`. Deliberate and
  test-pinned ("gap-eligible, not absent"); the literal PRD wording
  "rather than covered" is satisfied at the dispatch level — the suspect
  does get re-seeded.
- `present`/`missing` vs flagged-suppressed — a flagged date suppressed
  by a live-queue entry lands in `suppressed` only; bounded one-sweep
  stall, self-corrects when the queued seed gcs-hits.
- `markChainConfirmed`/`setChainFlag` without `ifMetagenerationMatch` —
  one writer per date in practice; the stamp pass is deliberate ops.
- Confirm path keeps the original object's stamped flag when the refetch
  returns a *different* flag — cosmetic; any flag + confirmed is a
  thin chain.
- Confirm path returns `status:'stored'` — the item is confirmed present;
  a distinct variant would ripple through `SeedWorkerResult` consumers
  for zero behavioral gain.
- `--stamp-flags`/`setChainFlag` scope — not in the ACs but the required
  backfill path for pre-flagging-code suspects (4 real QQQ `calls_only`
  objects found); metadata-only, documented as deliberate ops.
- `corpus-seed.worker.ts` at 317 lines — under the 400 hard line; the
  thermo axis explicitly judged the file should not be split (branch
  structure stays legible post-dedup).
- `empty` fresh seeds cost one verification re-fetch before confirmed —
  "upstream-confirmed" semantics requires a reproducing fetch.

### Test results

- `npx jest` — **107 suites / 1,248 tests green** (incl. ~25 new #227
  tests: flag derivation, adapter stamping/projection/conditional-write,
  worker counts + forceRefetch heal/confirm/short-circuit/retry,
  reconciler consumption + kind preservation, metadata flatten).
- `npx tsc --noEmit` — clean. `git diff --check` — clean.
- Prod verify (`options-data-227-chain-sanity-flags.ts`, dry): **PASS** —
  QQQ 1,966 objects, 209 in-window recounted (0 corrupt), drift=4 (all
  real `calls_only`); probes prove forceRefetch dispatch + thin-chain
  logging; run-item fields informational pre-deploy.

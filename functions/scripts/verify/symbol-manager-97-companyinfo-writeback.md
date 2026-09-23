# Verification Guide: Task #97 — companyInfo marketCap/beta write-back

## Scripts

### symbol-manager-97-companyinfo-writeback.ts

**Purpose:** Verifies the company-overview write-back end-to-end against prod Firestore: a real stored `symbol-data` overview doc is parsed by the production `buildTrackedSymbolCompanyInfo` and merged onto `tracked-symbols/{SYM}`, then read back to confirm `marketCap`/`beta` are stored as Firestore numbers (not strings).

**Pipeline stages verified:**
- Transform: real stored AV overview doc → `Partial<TrackedSymbolCompanyInfo>` with numeric `marketCap`/`beta`
- Persistence: merge write to `tracked-symbols/{SYM}` + read-back type assertion
- Omission: `"None"`/undefined source values produce no field (never `NaN`)

**Command:**
```bash
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/symbol-manager-97-companyinfo-writeback.ts
```

**Arguments:** none. The symbol is hardcoded to `NVDA` (known to have both `MarketCapitalization` and `Beta` in its stored overview doc).

**What it checks (11 checks):**
1. Overview doc exists at `symbol-data/NVDA/company-overview/av-company-overview`
2. Overview doc has `MarketCapitalization`
3. Overview doc has `Beta`
4. `marketCap` parses to a finite number
5. `beta` parses to a finite number
6. `Sector` preserved verbatim
7. Stored `companyInfo.marketCap` is a Firestore number
8. Stored `companyInfo.beta` is a Firestore number
9. Doc-root `_companyInfoLastUpdated` is a real Timestamp after the merge write
10. `marketCap` omitted when source is `"None"`
11. `beta` omitted when source is undefined

**Passing result:** All checks print `PASS:`, ends with `=== All verification checks passed ===`, exits 0.

**Failing result:** First failure prints `FAIL:` with details, exits 1.

**Setup/teardown:** None. Side effect: writes `companyInfo.marketCap`/`beta` + `_companyInfoLastUpdated` to `tracked-symbols/NVDA` — this is the intended end-state of the feature, no cleanup needed. Requires prod Firestore credentials (ADC).

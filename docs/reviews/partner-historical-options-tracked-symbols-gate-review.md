# Partner Historical Options — Tracked-Symbols Gate Review

**Date:** 2026-09-15
**Base:** HEAD (uncommitted working-tree changes)
**Working tree changes:** tracked-symbols gate for `partnerHistoricalOptionsV2`, discovery doc update
**Reviews run:** `code-review` (Standards + Spec) + `thermo-nuclear-code-review` via `.devin/skills/code-review/SKILL.md`

---

## 1. Scope / change inventory

| File | Status | Notes |
|---|---|---|
| `functions/src/v2/alpha-vantage/services/symbol-manager.service.ts` | modified | Adds `isSymbolTracked` method |
| `functions/src/v2/partner/historical-options-partner.ts` | modified | Wires `isSymbolTracked` into DI interface + handler gate |
| `docs/partner/options-data/historical-options-discovery.md` | modified | New "Symbol Scope" section, 404 error row, parameter clarification |

---

## 2. Standards

### Finding S1: Duplicated Code — `isSymbolTracked` re-implements `getSymbol` (judgement call)

**Problem:** `isSymbolTracked` duplicates the Firestore `.doc(symbol.toUpperCase()).get()` + existence check already in `getSymbol`. Two code paths must stay in sync for collection name and normalization.

```ts
// isSymbolTracked (new) — lines 65-78
const doc = await db.collection(FirestoreCollection.TRACKED_SYMBOLS)
  .doc(symbol.toUpperCase())
  .get();
return doc.exists;

// getSymbol (existing) — lines 29-58
const doc = await db.collection(FirestoreCollection.TRACKED_SYMBOLS)
  .doc(symbol.toUpperCase())
  .get();
if (!doc.exists) return null;
```

**Fix:** Delegate to `getSymbol`:

```ts
async isSymbolTracked(symbol: string): Promise<boolean> {
  if (!symbol || typeof symbol !== 'string') return false;
  try {
    return (await this.getSymbol(symbol)) !== null;
  } catch {
    return false;
  }
}
```

### Finding S2: Duplicated Code — 7th hand-rolled error envelope (judgement call)

**Problem:** The handler now has 7 copies of the `{ ok, error, code, timestamp }` error shape. The diff adds one more instead of extracting a helper.

```ts
res.status(404).json({
  ok: false,
  error: `Symbol ${symbol} is not tracked`,
  code: HistoricalOptionsErrorCode.NOT_FOUND,
  timestamp: dependencies.now().toISOString(),
});
```

**Fix:** Extract a `sendPartnerError` helper and replace all 7 sites:

```ts
function sendPartnerError(
  res: Response,
  status: number,
  code: HistoricalOptionsErrorCode,
  message: string,
  now: () => Date,
): void {
  res.status(status).json({
    ok: false,
    error: message,
    code,
    timestamp: now().toISOString(),
  });
}
```

### Finding S3: Mysterious Name — `sMSvc iST` log prefix (judgement call, not fixed)

Follows existing repo convention (`sMSvc gS`, `sMSvc cAS`). Consistent but not guessable in isolation. Not addressed — changing would break the convention.

### Finding S4: Middle Man — DI forwarder (judgement call, not fixed)

`isSymbolTracked: (symbol) => symbolManagerService.isSymbolTracked(symbol)` is a pure forwarder. Justified by the testability seam — consistent with all other deps in the interface. Not addressed.

---

## 3. Spec

### Finding P1: 404 message mismatch with discovery doc

**Problem:** Handler returns `error: "Symbol ${symbol} is not tracked"`. Discovery doc error table says: `"The requested symbol is not in the tracked_symbols collection. Add the symbol to tracked_symbols before retrying."`

**Fix:** Update the handler message to match the doc:

```ts
error: `Symbol ${symbol} is not in the tracked_symbols collection. Add the symbol to tracked_symbols before retrying.`,
```

### Finding P2: No `isActive` filter (invalidated by user guidance)

The spec reviewer flagged that `isSymbolTracked` doesn't filter `isActive`. **User confirmed `isActive` is deprecated** — the gate is purely doc existence. Not a bug; no fix needed.

### Finding P3: Discovery doc presents behavior as live before deployment (intentional)

The doc was updated per user instruction ("assume tracked symbols gate is implemented"). Intentional; no fix needed.

---

## 4. Thermo-Nuclear

### Finding T1: Test suite broken (BLOCKER)

**Problem:** `functions/tests/v2/partner/historical-options-partner.test.ts` `createDependencies` factory omits `isSymbolTracked`. Three tests passing valid symbol `AAPL` now throw `TypeError` and return 500 instead of expected 504/200/413.

**Fix:** Add `isSymbolTracked: async () => true` to the default factory. Add a 404 test for untracked symbols. Verify existing tests pass.

### Finding T2: `isSymbolTracked` duplicates `getSymbol` (same as S1)

Addressed by S1 fix above.

### Finding T3: Repeated error-envelope boilerplate (same as S2)

Addressed by S2 fix above.

---

## 5. Fix summary

| Finding | Severity | Fixed |
|---|---|---|
| S1 / T2: `isSymbolTracked` duplicates `getSymbol` | Judgement call | Yes — delegate to `getSymbol` |
| S2 / T3: Error envelope boilerplate | Judgement call | Yes — extract `sendPartnerError` |
| P1: 404 message mismatch | Minor | Yes — match discovery doc |
| T1: Broken test suite | Blocker | Yes — add to factory + new tests |
| S3: `iST` log prefix | Judgement call | No — follows convention |
| S4: DI middle man | Judgement call | No — justified by testability |
| P2: No `isActive` filter | Invalidated | No — `isActive` deprecated per user |
| P3: Doc ahead of deployment | Intentional | No — per user instruction |

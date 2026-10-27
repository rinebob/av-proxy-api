# Task #205 verification — ops-alert message composer

**Task:** #205 (Message composer — signoff + exception texts)
**Scope:** pure functions in `src/v2/common/ops-alerts/ops-alert.composer.ts`
(`composeIntradaySignoff`, `composePostSignoff`, `composeException`).

## Scripts

### `ops-sms-alerts-205-compose-texts.ts` — read-only, in run-all

Composes every message type with representative inputs and prints each text
with its char count for human readability review.

**What it verifies:**
- every message type ≤ 300 chars (~2 SMS segments)
- no `undefined` / `NaN` leaks into any text (graceful degradation)
- signoffs carry counts + PDR confirmation; exceptions name the run and
  where to look next (run doc id when known)

**Run:**
```bash
cd functions
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/ops-sms-alerts-205-compose-texts.ts
```

**Pass:** every line `PASS: ...`, all texts printed, ends with
`=== All verification checks passed ===`.
**Fail:** a `FAIL: ...` line naming the broken check (length, leak, content);
exit code 1.

**Setup/teardown:** none — pure functions, no environment access.

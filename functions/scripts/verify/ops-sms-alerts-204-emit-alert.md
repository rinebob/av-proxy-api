# Verify: Task #204 — Canonical alert event + fail-safe emitter

Pipeline stage: **alert emission** (the canonical seam all later SMS work rides on).

## `ops-sms-alerts-204-emit-alert.ts`

Calls `emitOpsAlert()` for real against prod Firestore.

**Mutating** — writes + deletes one `ops-alerts/verify:ops-204:{date}` doc in prod. Not part of `run-all.ts`; run manually.

### Run

```bash
cd functions
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/ops-sms-alerts-204-emit-alert.ts
```

### What it confirms

1. The canonical `ops.alert` log line prints (visible in output) carrying the complete `smsText`, `runId`, and `marketDate`.
2. An audit doc is persisted at `ops-alerts/{alertKey}` with `alertKey`, `kind`, `smsText`, `runId`, `marketDate`, `context`, `emittedAt`.
3. Re-emitting the same `alertKey` overwrites the doc (dedupe by deterministic doc id — never a duplicate).
4. Probe doc is deleted afterward.

### Pass

`ALL CHECKS PASSED` + exit 0, with an `event=ops.alert` line visible in output.

### Fail

Any `FAIL:` line + exit 1. A thrown error inside `emitOpsAlert` would also indicate a broken fail-safe contract (it must never throw).

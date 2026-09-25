# admin/

Operator-run administrative scripts (auth'd-operator actions, not scheduled jobs).

## enable-options.ts — batch-enable `optionsEnabled` (Task #141)

Bulk-curates the `optionsEnabled` flag through the same governed path as the
`setOptionsEnabledV2` callable: per symbol it requires `optionable === true`,
appends an `optionsEnabledHistory` entry (`changedBy: 'admin-script'`), bumps
`_lastUpdated`, and enqueues `generateSwingSetsTask` on each `false → true`
transition. Already-enabled symbols are idempotent no-ops; non-optionable and
untracked symbols are reported and skipped.

```
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json \
  scripts/admin/enable-options.ts --symbols AAPL,MSFT --reason "pilot batch" [--dry-run]
```

| Flag | Meaning |
|---|---|
| `--symbols A,B` | Comma-separated symbols (normalized to uppercase, deduped) |
| `--symbols-file <path>` | Read symbols from a file — one per line or comma-separated |
| `--reason "..."` | Optional; recorded in each history entry |
| `--dry-run` | Read-only preview: runs the real core against a no-op-writing `db` and stubbed enqueue, so the reported outcome is the governed decision (gate, validation) — writes nothing, enqueues nothing |

Summary counts: Enabled / Already enabled / Not optionable / Not tracked / Errors.
Exit code 1 if any symbol errored; exit code 2 for missing/invalid invocation args.

**Notes**

- Symbols that haven't been optionable-probed yet (`optionable` absent) are
  reported as `not-optionable` — run `scripts/backfill/backfill-optionable.ts`
  first (Task #143), or `--symbols` it to probe a subset.
- Enqueue failures warn but don't fail the symbol's write — the swing-set
  sweep (`sweepSwingSets`) re-discovers enabled symbols missing generated sets.

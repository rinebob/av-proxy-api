# Agent notes

## Issue references in conversation

Always include the descriptive name alongside every issue/task number — e.g.
"Task #140 (setOptionsEnabledV2 callable)", not just "#140". The topic number
is recognizable; stage/blueprint/task numbers are meaningless on their own.

## Verification

- Functions tests: `cd functions; npx jest`
- Typecheck: `cd functions; npx tsc --noEmit`
- Shared rebuild required after `shared/` edits: `npm run build:shared`, then
  `cd functions; npx jest --clearCache` if type errors persist (stale cache).

## Temp files

Repository-local temp files go under `.devin/tmp/` (gitignored).

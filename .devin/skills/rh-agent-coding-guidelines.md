---
name: rh-agent-coding-guidelines
description: Apply RH Agent-specific coding standards when writing or refactoring code in functions/src/rh-agent-cloud-function or src/app/features/rh-agent. Prevents monolithic files, duplicated code, inconsistent patterns, boundary drift, and dead code.
disable-model-invocation: true
---

# RH Agent Coding Guidelines

Apply these rules when writing, editing, or reviewing code in the RH Agent directories:

- `functions/src/rh-agent-cloud-function/`
- `src/app/features/rh-agent/`

These standards are derived from the thermonuclear review of the RH Agent feature. They are designed to keep the code maintainable, consistent, and free of the structural debt that already exists in this area.

## 1. Keep files small and single-purpose

- **Target under 300 lines per file.** If a file crosses 400 lines, consider it a strong smell.
- **Never let a file cross 1k lines without a documented, team-approved reason.**
- **One file, one responsibility.** Do not mix:
  - HTTP entry points / Cloud Functions with domain logic
  - Data loading with persistence orchestration
  - Chart rendering with chart data loading and chart configuration
  - UI state with persistence logic
- **Examples from the current codebase to avoid:**
  - `rh-agent-worker.ts` (555 lines) mixes orchestration, data loading, persistence, and counters.
  - `rh-agent.service.ts` (455 lines) mixes runs, status, signals, charts, and backfill.
  - `signal-detail.component.ts` (438 lines) mixes layout, data loading, chart configuration, and indicator injection.

## 2. Do not duplicate code across the boundary or within a layer

- **Canonical types must exist once.** `OhlcBar`, `ChartInterval`, `IndicatorFamily`, `StrategyFamily`, and the indicator response shapes must not be redefined in multiple files.
- **Shared constants must exist once.** `ALLOWED_ORIGINS` / CORS allowlists, collection names, and enum values should live in a single source of truth.
- **Do not mirror types between frontend and backend.** If a shared type is needed, import it from a side-effect-free shared location or document why duplication is unavoidable.
- **Examples from the current codebase to avoid:**
  - `OhlcBar` defined in `symbol-data-sync.ts`, `rh-agent-indicator-computation.ts`, and `rh-agent-chart.service.ts`.
  - `ALLOWED_ORIGINS` defined separately in `rh-agent-callables.ts`, `rh-agent-indicator-series.ts`, and inline in `rh-agent-executor.ts`.
  - Frontend `rh-agent-indicator.types.ts` mirroring backend types with a comment saying duplication is intentional.

## 3. Do not write dead code or premature abstractions

- **Do not keep unused enum values, functions, or subcollection logic "for later."** If a feature is not wired up, remove it. Reintroduce it when the feature is actually implemented.
- **Do not keep no-op functions** that exist only because an old path was abandoned.
- **Do not define a generalized abstraction for one caller.** If a helper, interface, or state machine has only one consumer, inline it or wait until a real second use case appears.
- **Examples from the current codebase to avoid:**
  - Counter-trend enum values (`*_CT_LONG`) defined in `rh-agent-config.ts` but never emitted.
  - `clearStaleInterimSignals` as a no-op after `signal-dates` was abandoned.
  - `writeIntradayBarsToRsBars` defined but never called.
  - `SignalDateWriter` persisting to a `signal-dates` subcollection that is no longer used.

## 4. Keep design patterns consistent

- **Backend Cloud Functions:**
  - Entrypoint files should only parse input, validate auth, call domain helpers, and return responses.
  - Domain logic belongs in focused helpers/classes.
  - Workers should be thin orchestrators: load data → execute strategy → persist → report progress.
- **Frontend Angular:**
  - Services should be scoped by domain: runs, signals, charts, lists, triage, meta.
  - Components should own layout and delegate state to stores.
  - Stores should be scoped by domain and avoid reading four other stores inside one giant computed.
- **Use the same pattern everywhere.** If a feature uses NgRx Signals for state, do not introduce a new state pattern for the same feature without team approval.
- **Examples from the current codebase to avoid:**
  - `RhAgentService` acting as a god object for all RH Agent callable/Firestore interactions.
  - `SignalDetailComponent` building chart configs, loading data, and managing indicator selection all in one file.
  - `RhAgentGroupStore.groups` touching `historyStore`, `symbolListStore`, `triageStore`, and internal state in a single computed.

## 5. Maintain clean type and boundary contracts

- **Do not use `any` index signatures** to hide shape mismatches.
- **Do not silently fallback to production defaults** for secrets, URLs, or account numbers.
- **Return values should be predictable.** If a function returns an array, return an empty array (with a flag if needed), not `null`.
- **Functions that cross a boundary** (HTTP, callable, component input) should have explicit typed contracts.
- **Examples from the current codebase to avoid:**
  - `OHLCV` interface with `[key: string]: any`.
  - `getCachedBars` returning `null` per bar array.
  - `rh-agent-executor.ts` falling back to a live production MCP URL and a hardcoded account number.
  - `rhAgentGetAccountSummary` using `cors: true` while other functions use a restricted allowlist.

## 6. Keep writes atomic and orchestration explicit

- **Related Firestore writes should be in a single batch or transaction.** Do not fire independent promises in parallel when partial failure leaves the system inconsistent.
- **Avoid unnecessary sequential orchestration.** If steps are independent, run them in parallel. If steps are dependent, make the dependency explicit.
- **Examples from the current codebase to avoid:**
  - `SignalDateWriter.persistBarDate` writing `run-ids`, gate dates, and `signal-history` in parallel.
  - `rh-agent-worker.ts` executing a long sequential sequence that could be split into focused helpers.

## 7. Security defaults

- **Do not use `invoker: 'public'` on functions that expose data or trigger side effects.** If the project has a documented exception, keep the exception scoped and temporary.
- **Do not use `cors: true` on production callables.** Maintain a single, explicit CORS allowlist.
- **Secrets must fail closed.** If a required secret is missing, the function should fail, not fall back to a default.
- **Examples from the current codebase to avoid:**
  - `rh-agent-dashboard-callables.ts` and `rh-agent-overview-sync-orchestrator.ts` using `invoker: 'public'`.
  - `rh-agent-executor.ts` defaults to a live MCP URL and a hardcoded account number.

## 8. Naming and semantics

- **Signal type names should match what the code emits.** Do not define enum values that no code path produces.
- **Function names should describe what they actually do.** A function called `writeIntradayBarsToRsBars` that is never called is worse than no function.
- **Prefer explicit names over generic ones.** `loadData` is too vague for a function that reads `symbol-data` subcollections and injects intraday bars.
- **Examples from the current codebase to avoid:**
  - `*_CT_LONG` enum values with no emission path.
  - `loadData` in `rh-agent-worker.ts` doing symbol-data loading + intraday injection.

## 9. Before adding a new file or function, ask these questions

- Does this file already exist in a similar form? Can I extend the existing one instead of creating a new one?
- Will this file cross 300 lines? If so, how will I decompose it?
- Is this logic duplicated anywhere in the frontend, backend, or across the boundary?
- Is this an abstraction for a future feature that does not exist yet? If so, can it be deleted?
- Does this change rely on `any`, silent defaults, or null-heavy return types?
- Are related Firestore writes atomic?
- Does this change keep the same design pattern as the surrounding code?

## 10. LLM implementation checklist

When generating a new RH Agent implementation, verify before submitting:

- [ ] No file exceeds 400 lines without a documented reason.
- [ ] No new duplication of `OhlcBar`, `ALLOWED_ORIGINS`, collection names, or signal enums.
- [ ] No `any` index signatures or silent production defaults.
- [ ] No unused enum values or no-op functions introduced.
- [ ] Admin/data callables are not public unless explicitly required and documented.
- [ ] Related Firestore writes are batched or transactional.
- [ ] New types are shared across the boundary if both frontend and backend need them.
- [ ] Existing helpers are reused instead of writing bespoke one-offs.
- [ ] A regression test covers the new behavior and any bug it fixes.
- [ ] The README or planning doc is updated if the architecture or public contract changes.

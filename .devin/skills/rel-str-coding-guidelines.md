---
name: rel-str-coding-guidelines
description: Apply project-wide coding standards for the rel-str Angular + Firebase codebase. Prevents monolithic files, duplicated code, inconsistent patterns, boundary drift, dead code, and security anti-patterns.
disable-model-invocation: true
---

# rel-str Coding Guidelines

Apply these rules when writing, editing, or reviewing code anywhere in the project:

- `src/app/`
- `functions/src/`
- `functions/scripts/`
- `docs/`, `.devin/`, and other project documentation

These standards are derived from the thermonuclear review of the RH Agent feature and are intended to prevent the same structural debt from appearing across the rest of the codebase.

## 1. Keep files small and single-purpose

- **Target under 300 lines per file.** If a file crosses 400 lines, treat it as a strong smell.
- **Never let a file cross 1k lines without a documented, team-approved reason.**
- **One file, one responsibility.** Do not mix:
  - HTTP entry points / Cloud Functions with domain logic
  - Data loading with persistence orchestration
  - Chart rendering with chart data loading and chart configuration
  - UI state with persistence logic
  - Shared utilities with feature-specific logic
- **Examples of files that violate this principle:**
  - A Cloud Functions worker that mixes orchestration, data loading, persistence, and counters.
  - An Angular service that handles every callable/Firestore interaction for a feature.
  - A component that builds chart configs, loads data, and manages indicator selection in one file.

## 2. Do not duplicate code across the boundary or within a layer

- **Canonical types must exist once.** Shared data shapes (e.g., bar types, interval enums, indicator families, response contracts) must not be redefined in multiple files.
- **Shared constants must exist once.** CORS allowlists, collection names, enum values, and magic numbers should live in a single source of truth.
- **Do not mirror types between frontend and backend.** If both sides need a type, place it in a side-effect-free shared location or document why duplication is unavoidable.
- **Examples of duplication to avoid:**
  - The same bar shape defined in `symbol-data-sync.ts`, a cloud function file, and the frontend chart service.
  - CORS allowlists defined separately in multiple callable files.
  - Frontend files duplicating backend contracts with a comment saying the duplication is intentional.

## 3. Do not write dead code or premature abstractions

- **Do not keep unused enum values, functions, or subcollection logic "for later."** If a feature is not wired up, remove it. Reintroduce it when the feature is actually implemented.
- **Do not keep no-op functions** that exist only because an old path was abandoned.
- **Do not define a generalized abstraction for one caller.** If a helper, interface, or state machine has only one consumer, inline it or wait until a real second use case appears.
- **Examples of dead code to avoid:**
  - Enum values defined but never emitted by any code path.
  - No-op functions left after an old subcollection is abandoned.
  - Helper functions defined but never called.
  - Classes that persist to a subcollection that is no longer used.

## 4. Keep design patterns consistent

- **Backend Cloud Functions:**
  - Entrypoint files should only parse input, validate auth, call domain helpers, and return responses.
  - Domain logic belongs in focused helpers/classes.
  - Workers should be thin orchestrators: load data → execute domain logic → persist → report progress.
- **Frontend Angular:**
  - Services should be scoped by domain.
  - Components should own layout and delegate state to stores.
  - Stores should be scoped by domain and avoid reading many other stores inside one giant computed.
- **Use the same pattern everywhere.** If a feature uses NgRx Signals for state, do not introduce a new state pattern for the same feature without team approval.
- **Examples of inconsistency to avoid:**
  - A service acting as a god object for all backend interactions in a feature.
  - A component that mixes layout, data loading, and configuration.
  - A store computed that reads four other stores and performs multiple merges.

## 5. Maintain clean type and boundary contracts

- **Do not use `any` index signatures** to hide shape mismatches.
- **Do not silently fallback to production defaults** for secrets, URLs, account numbers, or credentials.
- **Return values should be predictable.** If a function returns an array, return an empty array (with a flag if needed), not `null`.
- **Functions that cross a boundary** (HTTP, callable, component input, shared utility) should have explicit typed contracts.
- **Examples of boundary smells to avoid:**
  - Interfaces with `[key: string]: any`.
  - Functions returning `null` per element when an empty array is more appropriate.
  - Callable functions falling back to a live production URL or hardcoded account number.
  - One callable using `cors: true` while others use a restricted allowlist.

## 6. Keep writes atomic and orchestration explicit

- **Related Firestore writes should be in a single batch or transaction.** Do not fire independent promises in parallel when partial failure leaves the system inconsistent.
- **Avoid unnecessary sequential orchestration.** If steps are independent, run them in parallel. If steps are dependent, make the dependency explicit.
- **Examples of orchestration smells to avoid:**
  - Writing related docs in parallel with `Promise.all`.
  - A long sequential worker function that could be split into focused helpers.

## 7. Security defaults

- **Do not use `invoker: 'public'` on functions that expose data or trigger side effects.** If the project has a documented exception, keep the exception scoped and temporary.
- **Do not use `cors: true` on production callables.** Maintain a single, explicit CORS allowlist.
- **Secrets must fail closed.** If a required secret is missing, the function should fail, not fall back to a default.
- **Examples of security anti-patterns to avoid:**
  - Public invokers on admin or data-exposing functions.
  - Wide-open CORS on callables.
  - Live production defaults or hardcoded credentials as fallbacks.

## 8. Naming and semantics

- **Enum and signal names should match what the code emits.** Do not define values that no code path produces.
- **Function names should describe what they actually do.** Do not keep functions that are never called.
- **Prefer explicit names over generic ones.** `loadData` is too vague for a function that reads a specific collection and applies specific transformations.
- **Examples of naming smells to avoid:**
  - Enum values with no emission path.
  - Functions defined but never invoked.
  - Generic names like `loadData`, `process`, or `handle` that hide the actual responsibility.

## 9. Before adding a new file or function, ask these questions

- Does this file already exist in a similar form? Can I extend the existing one instead of creating a new one?
- Will this file cross 300 lines? If so, how will I decompose it?
- Is this logic duplicated anywhere in the frontend, backend, or across the boundary?
- Is this an abstraction for a future feature that does not exist yet? If so, can it be deleted?
- Does this change rely on `any`, silent defaults, or null-heavy return types?
- Are related Firestore writes atomic?
- Does this change keep the same design pattern as the surrounding code?
- If this is a shared type, is it in a side-effect-free location accessible to both frontend and backend?

## 10. LLM implementation checklist

When generating a new implementation, verify before submitting:

- [ ] No file exceeds 400 lines without a documented reason.
- [ ] No new duplication of shared types, CORS lists, collection names, or enums.
- [ ] No `any` index signatures or silent production defaults.
- [ ] No unused enum values or no-op functions introduced.
- [ ] Admin/data callables are not public unless explicitly required and documented.
- [ ] Related Firestore writes are batched or transactional.
- [ ] New types are shared across the boundary if both frontend and backend need them.
- [ ] Existing helpers are reused instead of writing bespoke one-offs.
- [ ] A regression test covers the new behavior and any bug it fixes.
- [ ] The README or planning doc is updated if the architecture or public contract changes.

## 11. Per-feature check

When reviewing a feature that has not been audited yet, run the same questions used in the RH Agent thermonuclear review:

- Does this feature have a clear data flow diagram?
- Are there files that mix multiple responsibilities?
- Are there duplicate types, helpers, or constants?
- Are there unused abstractions or dead code paths?
- Are callable functions correctly secured?
- Are related Firestore writes atomic?
- Does the frontend mirror backend types? If so, why?
- Are there hardcoded defaults, secrets fallbacks, or wide-open CORS?
- Are there files approaching or exceeding 1k lines?
- Are the same patterns used consistently across the feature?

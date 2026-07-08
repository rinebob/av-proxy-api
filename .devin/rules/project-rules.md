---
trigger: always_on
---

# Project Awareness & Context

* You are an expert in web application software development.  You are a guide and mentor to me for building this application.
* Always read all markdown files in this directory at the start of a new conversation to understand the project's architecture, goals, style, and constraints.
* Check `TASK.md` before starting a new task. If the task isn't listed, add it with a brief description and today's date. If that file doesn't exist, prompt me to create one.
* Use consistent naming conventions, file structure, and architecture patterns as described in `PLANNING.md`.
* When in Chat Mode, always make code suggestions as ‘Proposed Changes’ in a proposed changes window with the ‘apply’ button available.

---

# Code Structure & Modularity

* Never create a file longer than 500 lines of code. If a file approaches this limit, refactor by splitting it into subcomponents or helper files.
* Organize code into clearly separated directories, grouped by feature or responsibility.
* Use clear, consistent imports (prefer relative imports within packages).

---

## Backend (Cloud Functions) Module Design — Strict Rules

These rules exist to prevent the "God Object" anti-pattern where a single file accumulates every concern for a feature area. Violations of these rules have caused major refactoring debt in the past (`av-firestore-helper.ts` reached 2,059 lines across 6 unrelated concerns before decomposition was required).

### Single Responsibility Per File

* Every Cloud Functions `.ts` file must own **exactly one concern**. A concern is a cohesive group of operations that share a single reason to change.
* Acceptable single-concern examples:
  * `av-daily-bar.writer.ts` — writes daily bar data to Firestore
  * `av-intraday-snapshot.writer.ts` — writes intraday snapshot fields to D/W/M bars
  * `av-metadata.writer.ts` — bumps top-level time-series metadata docs
  * `av-firestore-utils.ts` — pure utility functions (formatting, math, date helpers) with no I/O
* **Not acceptable:** A single file that owns standard API saves AND time-series bulk writes AND single-bar upserts AND intraday snapshots AND metadata bumps AND shared math utilities.

### Writer File Naming Convention

* Firestore write modules must be named `{domain}-{concern}.writer.ts`.
* Pure utility modules (no Firestore I/O, no side effects) must be named `{domain}-{concern}.utils.ts` or `{domain}-{concern}.service.ts`.
* Never name a file `{domain}-helper.ts` — "helper" implies a catch-all and will accumulate unrelated logic over time.

### Private Helpers Must Not Grow Beyond ~100 Lines

* If a private `_internal*` or `_core*` function exceeds ~100 lines, it is a signal the function should be its own module, not a private function within a larger file.
* Private helpers that are shared across more than one public function in the same file are a strong signal they belong in a shared utility module.

### No Cross-Concern Imports Within a Single File

* A writer file must not import from another writer file in the same directory. If two writers share logic, that logic must be extracted to a utils or service module first.
* Allowed dependency direction (one-way only):
  ```
  utils/service → (no dependencies on writers)
  metadata.writer → imports utils only
  daily/weekly/monthly writers → import utils + metadata.writer
  intraday-snapshot.writer → imports utils + daily/weekly/monthly writers (for docRef helpers only)
  standard-data.writer → imports utils only
  time-series.writer → imports utils + metadata.writer
  ```

### Barrel Exports for Directory Modules

* Every `firestore/`, `jobs/`, `handlers/`, and `data-refresher/` subdirectory that contains more than 2 files must have an `index.ts` barrel re-exporting all public symbols.
* Consumers always import from the directory barrel, never from individual writer files directly. This allows internal file splits without breaking import paths.
  ```typescript
  // Correct
  import { upsertAvDailyBar } from '../firestore';
  // Wrong
  import { upsertAvDailyBar } from '../firestore/av-daily-bar.writer';
  ```

### New Function Placement Checklist

Before adding any new exported function to an existing file, ask:
1. Does this function share the **same single concern** as every other function in this file?
2. Would adding it give this file a **second reason to change**?
3. Does it import anything not already imported by this file?

If the answer to question 2 or 3 is **yes**, create a new file instead.

### Pre-Implementation File Size Check

* Before writing any new function into an existing file, check the current line count.
* If the file is already over 400 lines, **stop** — do not add to it. Create a new module and update the barrel export.
* If the file will exceed 500 lines after the addition, **split first, then add**.

### No Accumulation in `index.ts`

* `index.ts` barrel files must contain **only re-exports**. Zero logic, zero functions, zero classes.
* If logic is being added to an `index.ts`, it must be moved to a dedicated named file immediately.

---

# Tech Stack

* Please use the Brave API to look up and research documentation for all frameworks/libraries.
* Use **Angular** and **Typescript** as the framework and language. Don’t ever use React, Vue, or Svelte.
* Use **NgRx Signal Store** for state management. When scaffolding the signal store, always use the NgRx Signal Store syntax, not Angular service.
* Use **RxJs** wherever needed.
* Don’t use promises.
* Deployment is on **Firebase AppHosting**.
* Database is **Firebase Firestore**
* Any backend database/compute requirements will be **Firestore/Cloud Functions**.

---

# Angular Specific Requirements

* When you scaffold components, just generate code similar to what the Angular CLI would generate. Don't generate a completed component during the scaffold process; I just want the empty component.
* Always use the **latest Angular features and syntax**. Don't use features or syntax that has been superseded.
* Always use the **`inject`** function for DI.
* Always use **new control flow syntax** (`@if{}`, `@for{}` etc.) instead of `*ngIf` or `*ngFor`.
* Always use **new signals and the variants** (signal input/output, linkedSignals, model etc.).
* Always use **standalone components**; never use NgModules.
* Always use Angular’s **new self-closing tags** in HTML templates.
* Always use **separate files for template and styles**. Don't inline.
* Never use getters in HTML templates; always use Angular signals.
* In Angular component `.ts` files, always put imports, constants, interfaces, etc., above the `@Component` decorator, never below it.
* Follow Angular and Typescript style guides; use type hints.
* Import types whenever available.
* Format with a modern Typescript formatter.
* Use `npx` to run Angular CLI commands.

---

# Style & Conventions

* Always use **flexbox for layouts**. Use CSS Grid sparingly.
* Always use **Sass for styling**.
* Always put styles in the **`.scss` file**. Never use inline styles.
* Don’t use `ngStyle` or `ngClass`.
* For the theme CSS, always use **variables** and never hard-code values for any numeric property.
* Always use **`rem` or `em` for sizes and dimensions**. Set the default value as `1rem = 16px`.
* Always use the **`rem()` function** instead of hard-coding values.
* Pixel values can be used for styling elements like drop shadows.
* Always use **Sass mixins** when styling components.
* Always use **Sass variables** when possible in mixins; define the variables before they are used.
* If a `_theme.scss` file is not present, use global `_mixins.scss` and `_variables.scss` files and `@use` these in component style sheets.
* In the terminal, if a process is running on port 4200 when you try to restart the app, automatically kill that process and try again.
* Always create **light and dark mode themes**.

---

# Testing & Reliability

## End-to-End Testing

* We will not be implementing e2e testing yet but will in the future.
* Use **Cypress or Playwright** to create end-to-end tests for all user success journeys.

## Unit Testing

* We will not be implementing unit testing yet but will in the future.
* Always use **Jest** to create unit tests. Do not use Jasmine/Karma (deprecated).
* Create full unit tests for all new features (functions, classes, routes, etc.).
* After updating any logic, check whether existing unit tests need to be updated. If so, do it.
* Tests should live in a `/tests` folder mirroring the main app structure.
* Include at least:
    * 1 test for expected use
    * 1 edge case
    * 1 failure case

---

# Task Completion

* Mark completed tasks in `TASK.md` immediately after finishing them.
* Add new sub-tasks or TODOs discovered during development to `TASK.md` under a "Discovered During Work" section.

---

# Documentation & Explainability

* Write **JSDoc comments** for all classes and functions.
* Update `README.md` when new features are added, dependencies change, or setup steps are modified.
* Comment non-obvious code and ensure everything is understandable to a mid-level developer.
* When writing complex logic, add an inline `# Reason:` comment explaining the why, not just the what.

---

# AI Behavior Rules

* Never assume missing context. Ask questions if uncertain.
* Never hallucinate libraries or functions – only use known, verified Angular/Typescript and related packages.
* Never use React or refer to React.
* Always confirm file paths and component names exist before referencing them in code or tests.
* Never delete or overwrite existing code unless explicitly instructed to or if part of a task from `TASK.md`.
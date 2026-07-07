# Commit Message Skill

Use this skill whenever the user wants to commit local changes. Generate a
commit plan, not a single catch-all message.

## Usage

Trigger this skill when the user says anything like:

- "commit these changes"
- "write a commit message"
- "what should I commit"
- "stage and commit"
- "prepare a commit"

When triggered, run `git status` to see the modified files, then follow the
process below to produce a commit plan.

**Note:** The LLM generates the commit plan and staging lists. The user is the
one who actually runs `git add`, `git commit`, and `git push`.

## Process

1. Run `git status` to see every modified file.
2. Inspect the diffs briefly to understand the intent and logical grouping.
3. Group files into atomic commits by **area** and **concern**.
   - Common areas: `BE`, `FE`, `DOCS`, `CONFIG`, `TESTS`.
   - Do not split a single file across multiple commits.
   - Do not combine unrelated backend, frontend, and documentation changes into one commit.
4. Be more granular rather than less. If a single area contains both a feature addition and a refactor, prefer separate commits.
5. For each commit, produce:
   - A commit message using the convention below.
   - A separate **Files to stage** list so the user knows exactly what to include in that commit.

## Commit message convention

Use the prefix pattern:

```text
[AREA]-[TYPE]-[FEATURE]: short summary
```

When a change does not fit a specific feature, omit the feature name:

```text
[AREA]-[TYPE]: short summary
```

When a change is simple or broad, the area alone may be enough:

```text
[AREA]: short summary
```

- **AREA** — `BE` | `FE` | `DOCS` | `CONFIG` | `TESTS`
- **TYPE** — `FEAT` | `FIX` | `REFACTOR` | `CHORE` | `TEST` | `DOCS`
- **FEATURE** — the specific feature or component name, e.g., `RH-AGENT`, `PACR`, `DASHBOARD`, `CORE-ROUTES`, `HEATMAP`. Use it when the change is scoped to one feature.

## Message body

Every commit message must include a body that explains:

- **Why** the change was made.
- **What** the change does at a high level.

Do **not** put the file list inside the commit message. Provide the file list as a separate `Files to stage` section.

Example:

**Commit message:**

```text
BE-FEAT-RH-AGENT: add signalsGenerated counter and update status doc

Replace the legacy opportunitiesFound/opportunitiesApproved/... counters with a
single signalsGenerated counter. When a run completes, update the rh-agent-status
doc's totalSignalsGenerated atomically so the dashboard metric stays current.
```

**Files to stage:**

```text
functions/src/rh-agent-cloud-function/rh-agent-config.ts
functions/src/rh-agent-cloud-function/rh-agent-shared.ts
functions/src/rh-agent-cloud-function/rh-agent-trigger.ts
functions/src/rh-agent-cloud-function/rh-agent-worker.ts
```

## Rules

- **No one-line messages.** Every commit must have a subject plus a body.
- **No file appears in more than one commit.** If a change touches multiple
  concerns, describe the dominant concern and list the files once.
- **Group by area first, then by intent.** Do not create a single "everything" commit.
- **Use the user's prefix convention.** Prefer `FE-REFACTOR-FEATURE:`,
  `BE-FEAT-FEATURE:`, or `DOCS:` over conventional-commit style.
- **Present the plan for approval.** Do not commit or push unless the user
  explicitly says to do so.
- **Provide a separate `Files to stage` list alongside each message**, not inside the commit message body.
- **Avoid combining unrelated refactorings.** If the branch contains both a rename
  and a logic fix, split them.
  - **Put the message body in bullet points.** Don't use paragraph style commit message bodies.  Always list the changes as bullet points.
  - **If there is a planning doc, always add the section of the planning doc that the work pertains to.** Make sure to include the planning doc name and section number so we can track work progress in each commit.

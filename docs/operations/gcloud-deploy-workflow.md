# Deploying Cloud Functions via `gcloud` (Firebase CLI Bypass)

**Last updated:** 2026-06-15  
**Applies to:** `alpha-vantage-proxy-api` — Cloud Functions v2 (Gen2), `us-central1`

---

## Background & Why This Document Exists

The normal deployment command for this project is:

```powershell
firebase deploy --only functions
```

This command works most of the time. However, **it is unusable when the local network has intermittent TCP connection resets to Google APIs**, which manifests as a `read ECONNRESET` error during Firebase CLI's pre-deployment health checks.

### What Firebase CLI does before deploying

Before uploading any code, the Firebase CLI makes a series of blocking pre-flight HTTP calls to verify the project state:

1. Lists existing Cloud Functions via `cloudfunctions.googleapis.com`
2. Checks the Firestore database exists via `firestore.googleapis.com`
3. Checks enabled APIs via `serviceusage.googleapis.com`
4. Checks Cloud Storage buckets via `storage.googleapis.com`

**If any one of these calls fails with a connection reset, the entire deploy aborts** — even if the code built successfully and every other call succeeded. This makes the Firebase CLI deploy extremely brittle on networks with flaky TLS connections to Google APIs (e.g., corporate networks, certain ISPs, VPNs).

The error looks like this in the debug log:

```
FetchError: request to https://firestore.googleapis.com/v1/projects/alpha-vantage-proxy-api/databases/(default) failed, reason:
  at ClientRequest.<anonymous> (...\firebase-tools\node_modules\node-fetch\lib\index.js:1501:11)
```

The error message "There was an error retrieving the Firestore database" is **misleading** — the database exists and is healthy. The real issue is a TCP connection reset on the local machine.

### The alternative: `gcloud functions deploy`

Cloud Functions v2 are backed by Cloud Run services. The `gcloud` CLI can deploy them directly, bypassing all Firebase CLI pre-flight checks entirely. It uploads source directly to Cloud Build, which handles compilation and service update on Google's infrastructure.

---

## Prerequisites

### 1. Install the Google Cloud SDK

Download and install from: https://cloud.google.com/sdk/docs/install

On Windows, the installer places the SDK at:

```
C:\Users\<username>\AppData\Local\Google\Cloud SDK\google-cloud-sdk\
```

The key executable is:

```
C:\Users\<username>\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd
```

### 2. Add `gcloud` to your PATH (Windows)

After installing, the SDK installer should add its `bin` directory to your user PATH. However, **terminals that were already open before installation — including the IDE's integrated terminal — will not pick up the new PATH automatically**.

If `gcloud` is not recognized, run these two commands in your PowerShell terminal:

```powershell
# Updates PATH for the current terminal session immediately
$env:PATH += ";C:\Users\bob\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin"

# Persists the PATH change for all future terminal sessions
[Environment]::SetEnvironmentVariable("PATH", [Environment]::GetEnvironmentVariable("PATH", "User") + ";C:\Users\bob\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin", "User")
```

The first line takes effect immediately in the current session. The second line writes the change to the Windows user environment registry so all future terminals inherit it.

Verify with:

```powershell
gcloud version
# Expected output: Google Cloud SDK 572.0.0 (or newer)
```

> **Confirming the file exists before troubleshooting PATH:**
> ```powershell
> Test-Path "C:\Users\bob\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
> # Must return: True
> ```
> If this returns `False`, the SDK was installed to a different path. Find it with:
> ```powershell
> Get-ChildItem "C:\Users\bob\AppData\Local" -Recurse -Filter "gcloud.cmd" -ErrorAction SilentlyContinue | Select-Object FullName
> ```
> Substitute the correct path in the `SetEnvironmentVariable` command above.

### 3. Authenticate

Authenticate with the Google account that has access to the `alpha-vantage-proxy-api` project:

```powershell
gcloud auth login
```

This opens a browser window. Sign in with the appropriate Google account. After authenticating, set the active project:

```powershell
gcloud config set project alpha-vantage-proxy-api
```

Verify:

```powershell
gcloud auth list
gcloud config get-value project
```

---

## Critical Prerequisite: Fix `.gcloudignore`

### Why this matters

When `gcloud functions deploy` uploads your source, it uses `.gcloudignore` to decide which files to exclude — similar to how `.gitignore` works. The project's `.gcloudignore` originally contained this line:

```
#!include:.gitignore
```

This directive imports every exclusion rule from `.gitignore`, which includes:

```
# Build output
lib/
```

**This means the compiled TypeScript output (`lib/`) was excluded from the upload**, causing Cloud Build to fail with:

```
lib/src/index.js does not exist
```

This is a fatal error because `package.json` declares `"main": "lib/src/index.js"` — the compiled entry point. Without `lib/`, Cloud Build has no runnable code.

### The fix

Remove the `#!include:.gitignore` directive from `.gcloudignore` and replace it with explicit exclusions. The fixed file at `functions/.gcloudignore` now reads:

```
# This file specifies files that are *not* uploaded to Google Cloud
# using gcloud. It follows the same syntax as .gitignore, with the addition of
# "#!include" directives (which insert the entries of the given .gitignore-style
# file at that point).
#
# For more information, run:
#   $ gcloud topic gcloudignore
#
.gcloudignore
.git
.gitignore

# Exclude dev dependencies and local env files
node_modules
local-dev.env.alpha-vantage-proxy-api
*.local

# NOTE: lib/ is intentionally NOT excluded — compiled output must be uploaded
```

**Key change:** `#!include:.gitignore` is removed. `lib/` is intentionally absent from this file so the compiled output is uploaded to Cloud Build.

> **Important:** Never re-add `#!include:.gitignore` or a `lib/` line to `.gcloudignore`. Doing so will break `gcloud` deploys silently.

---

## Step-by-Step Deploy Process

### Step 1: Build the TypeScript source

From the `functions/` directory, compile all TypeScript to JavaScript:

```powershell
cd c:\aa\projects\av-proxy-api\functions
npm run build
```

This script does three things:
1. **`copy-shared`** — Builds the `shared/` package and copies its compiled output into `functions/lib/shared/`
2. **`tsc -p tsconfig.json`** — Compiles all `src/` TypeScript to `lib/src/`
3. **`tsc-alias`** — Resolves TypeScript path aliases (e.g., `@shared/`) to relative paths in the compiled output
4. **`tsc -p scripts/tsconfig.json`** — Compiles utility scripts

The build must succeed (exit code 0) before deploying. If it fails, fix TypeScript errors first.

### Step 2: Deploy the target function(s)

Run one `gcloud functions deploy` command per function. Replace `<functionName>` with the exact exported function name from `functions/src/index.ts`.

```powershell
& "C:\Users\bob\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" functions deploy <functionName> `
  --gen2 `
  --region=us-central1 `
  --project=alpha-vantage-proxy-api `
  --source=. `
  --runtime=nodejs20 `
  --entry-point=<functionName> `
  --trigger-http `
  --no-allow-unauthenticated
```

### Function name casing

Both the deploy name (positional argument after `functions deploy`) and `--entry-point` must use **camelCase**, exactly matching the exported function name in `functions/src/index.ts`.

| What | Case | Example |
|------|------|---------|
| Deploy name (positional arg) | camelCase | `processIntradaySnapshotJobTask` |
| `--entry-point` | camelCase | `processIntradaySnapshotJobTask` |

Both values must be **identical** to each other and to the export in `index.ts`. GCP internally lowercases the Cloud Run service name (e.g., `processintradaysnapshotjobtask`), but the arguments you pass to `gcloud` must remain camelCase.

Examples from `functions/src/index.ts`:

```
processIntradaySnapshotJobTask   ← Cloud Tasks worker
processIntradaySnapshotJobDev    ← HTTP dev/test entry point
runIntradaySnapshotDev           ← HTTP trigger that enqueues tasks
processTimeSeriesJobTask         ← Daily time-series Cloud Tasks worker
refreshAvDailyTimeSeriesPostClose ← Scheduled function
```

> **Wrong:** `--entry-point=processintradaysnapshotjobtask` (all lowercase — will fail with "function not found")  
> **Wrong:** `--entry-point=ProcessIntradaySnapshotJobTask` (PascalCase — will fail)  
> **Correct:** `--entry-point=processIntradaySnapshotJobTask`

**Flag explanations:**

| Flag | Purpose |
|------|---------|
| `--gen2` | Targets Cloud Functions v2 (backed by Cloud Run). Required — without this, `gcloud` targets v1 and will conflict with existing v2 deployments. |
| `--region=us-central1` | Deployment region. Must match the region the function is already deployed to. |
| `--project=alpha-vantage-proxy-api` | GCP project ID. |
| `--source=.` | Upload the current directory (must be run from `functions/`). This uploads `lib/`, `src/`, `package.json`, etc. |
| `--runtime=nodejs20` | Node.js runtime version. Must match `"engines": { "node": "20" }` in `package.json`. |
| `--entry-point=<functionName>` | The named export in `lib/src/index.js` that Cloud Run will invoke. Must exactly match the exported function name. |
| `--trigger-http` | Declares this as an HTTP-triggered function. Cloud Tasks workers and HTTP endpoints both use this trigger type. |
| `--no-allow-unauthenticated` | Requires a valid identity token for all invocations. Do not remove — this is the auth model for all internal functions. |

### Step 3: Verify the deployment

After the command exits with code 0, verify the function is live:

```powershell
& "C:\Users\bob\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" functions describe <functionName> --gen2 --region=us-central1
```

Check that:
- `state: ACTIVE`
- `updateTime` matches the deployment time
- `environmentVariables` contains expected keys (e.g., `TS_TIME_SERIES_TASKS_ENABLED`)
- `uri` is the expected Cloud Run URL

---

## Deploying Multiple Functions

`gcloud functions deploy` only deploys one function at a time. To deploy multiple functions, run sequential commands (or open multiple terminals for parallel deploys).

### Example: Deploying the three intraday snapshot functions

```powershell
$gcloud = "C:\Users\bob\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
$common = "--gen2 --region=us-central1 --project=alpha-vantage-proxy-api --source=. --runtime=nodejs20 --trigger-http --no-allow-unauthenticated"

& $gcloud functions deploy processIntradaySnapshotJobTask --entry-point=processIntradaySnapshotJobTask $common.Split(" ")
& $gcloud functions deploy processIntradaySnapshotJobDev   --entry-point=processIntradaySnapshotJobDev   $common.Split(" ")
& $gcloud functions deploy runIntradaySnapshotDev          --entry-point=runIntradaySnapshotDev          $common.Split(" ")
```

Or simply run each command separately:

```powershell
& "C:\Users\bob\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" functions deploy processIntradaySnapshotJobTask --gen2 --region=us-central1 --project=alpha-vantage-proxy-api --source=. --runtime=nodejs20 --entry-point=processIntradaySnapshotJobTask --trigger-http --no-allow-unauthenticated

& "C:\Users\bob\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" functions deploy processIntradaySnapshotJobDev --gen2 --region=us-central1 --project=alpha-vantage-proxy-api --source=. --runtime=nodejs20 --entry-point=processIntradaySnapshotJobDev --trigger-http --no-allow-unauthenticated

& "C:\Users\bob\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" functions deploy runIntradaySnapshotDev --gen2 --region=us-central1 --project=alpha-vantage-proxy-api --source=. --runtime=nodejs20 --entry-point=runIntradaySnapshotDev --trigger-http --no-allow-unauthenticated
```

---

## What Gets Deployed vs. What Firebase CLI Manages

Using `gcloud functions deploy` updates the **Cloud Run service and Cloud Build artifact** for the function. It does **not** update:

- Firestore security rules
- Firebase Hosting
- Firebase App Hosting
- Cloud Scheduler jobs
- Cloud Tasks queue configuration
- Environment variables set outside the `--set-env-vars` flag

For those, you still need `firebase deploy --only firestore:rules`, `firebase deploy --only hosting`, etc., or manage them via the GCP Console.

**Environment variables are preserved** across `gcloud functions deploy` — the command updates the service image but retains previously set env vars unless you explicitly pass `--set-env-vars` or `--remove-env-vars`.

---

## Troubleshooting

### `lib/src/index.js does not exist`

Cloud Build cannot find the compiled output. Causes:
1. **You forgot to run `npm run build`** before deploying. Run it first.
2. **`.gcloudignore` is excluding `lib/`**. Check that `#!include:.gitignore` is not present in `functions/.gcloudignore` and that `lib/` is not explicitly listed there.

### `gcloud is not recognized`

`gcloud` is not on your PATH. Either:
- Add `C:\Users\<username>\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin` to your PATH, or
- Use the full path: `& "C:\Users\bob\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"`

### `OperationError: code=7` (permission denied)

Your authenticated account does not have `roles/cloudfunctions.developer` or `roles/run.admin` on the project. Verify the active account:

```powershell
& "C:\Users\bob\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" auth list
```

Re-authenticate if needed:

```powershell
& "C:\Users\bob\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" auth login
```

### `Build failed` — Cloud Build logs

Open the Cloud Build URL printed in the deploy output to see the full build log. Common issues:
- `npm ci` fails due to missing optional dependencies — check `package.json` `optionalDependencies`
- TypeScript compile errors in the build step — ensure `npm run build` passes locally first

### `function not found` after deploy

The function name in `--entry-point` did not match an export in `lib/src/index.js`. Verify the exact export name in `functions/src/index.ts`.

---

## Quick Reference

```powershell
# From functions/ directory:

# 1. Build
npm run build

# 2. Deploy one function (replace <name> with the exported function name)
& "C:\Users\bob\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" functions deploy <name> --gen2 --region=us-central1 --project=alpha-vantage-proxy-api --source=. --runtime=nodejs20 --entry-point=<name> --trigger-http --no-allow-unauthenticated

# 3. Verify
& "C:\Users\bob\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" functions describe <name> --gen2 --region=us-central1
```

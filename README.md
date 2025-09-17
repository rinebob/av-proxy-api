# Alpha Vantage Proxy API

A secure proxy service for Alpha Vantage and Benzinga APIs with Firebase Authentication and Firestore caching.

## Features

- 🔒 Secure API proxy with Firebase Authentication
- ⚡ Cached responses in Firestore for better performance
- 🔄 Automatic token refresh and retry logic
- 🌐 CORS support with origin whitelisting
- 📊 Supports multiple API endpoints (Alpha Vantage & Benzinga)

## Local Emulator Quickstart (HTTP-first)

For a simplified local workflow that starts all emulators and triggers refresh over HTTP (no Functions shell), see:

- docs/local-emulator-workflow.md

Key HTTP endpoint for manual runs (emulator only):

```
GET http://127.0.0.1:5001/alpha-vantage-proxy-api/us-central1/refreshAlphaVantageDataV2Http
```

## Development Setup

### Prerequisites

- Node.js 18+
- Firebase CLI (`npm install -g firebase-tools`)
- Angular CLI (`npm install -g @angular/cli`)
- Firebase project with Firestore and Authentication enabled

### Environment Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-username/av-proxy-api.git
   cd av-proxy-api
   ```

2. **Install dependencies**
   ```bash
   # Install root dependencies
   npm install
   
   # Install functions dependencies
   cd functions
   npm install
   cd ..
   ```

3. **Environment Configuration**
   - Create `.env.alpha-vantage-proxy-api` in the `functions` directory:
     ```env
     # Alpha Vantage API Key for local development
     LOCAL_EMULATOR_ALPHAVANTAGE_API_KEY="your-api-key-here"
     
     # Benzinga API Key (optional)
     LOCAL_EMULATOR_BENZINGA_CALENDAR_API_KEY="your-benzinga-key-here"
     ```

4. **Firebase Setup**
   ```bash
   firebase login
   firebase init
   firebase use your-project-id
   ```

5. **Set Production Secrets**
   ```bash
   # Set Alpha Vantage API Key
   firebase functions:secrets:set ALPHAVANTAGE_API_KEY
   
   # Set Benzinga API Key (if using Benzinga features)
   firebase functions:secrets:set BENZINGA_CALENDAR_API_KEY
   firebase functions:secrets:set BENZINGA_WIIM_API_KEY
   ```

## Running Locally

### Terminal 1: Start Emulators
In the project root:
```bash
npm run emulators
```

### Terminal 2: Watch Backend Changes
In the `functions` directory:
```bash
npm run build:watch
```

### Terminal 3: Run Frontend
In the project root:
```bash
ng serve
```

## Shared Code Structure and Module Aliasing

### Shared Directory (`/shared`)

This monorepo contains a `shared` directory at the root, which holds all TypeScript code, interfaces, and utilities that are used by both the backend (`functions`) and the frontend (Angular app). This ensures type safety and code reuse across the entire stack.

- **Location:**  
  ```
  /shared
  ```
- **Compiled Output:**  
  The shared code is compiled to:
  ```
  /shared/lib
  ```

### How Backend Functions Use Shared Code

The backend Cloud Functions (in `/functions`) import shared code using the `@shared` alias. This is achieved through a combination of:

- **TypeScript `paths` mapping** in `functions/tsconfig.json`:
  ```json
  "paths": {
    "@shared/*": ["../shared/lib/*"]
  }
  ```
- **Runtime aliasing** via [`module-alias`](https://www.npmjs.com/package/module-alias) in `functions/package.json`:
  ```json
  "_moduleAliases": {
    "@shared": "../shared/lib"
  }
  ```

**Important:**  
- Always run and build from the monorepo root.  
- Never manually override the alias in code—let `module-alias` and the config handle it.
- If you change the structure of the `shared` directory, update both `tsconfig.json` and `package.json` accordingly.

### Troubleshooting

If you see errors like:
```
Cannot find module 'C:\aa\projects\shared\alpha-vantage'
```
or
```
Cannot find module 'C:\aa\projects\av-proxy-api\functions\C:\aa\projects\av-proxy-api\shared\lib\alpha-vantage'
```
- Make sure the `_moduleAliases` path is relative (as above).
- Rebuild both `shared` and `functions` (`npm run build` from root).
- Restart the emulator from the monorepo root.

## API Endpoints

### Alpha Vantage

#### Get Daily Stock Data
```
GET /getDailyStockDataSimple?symbol={symbol}&outputSize={compact|full}
```

#### Get Global Quote
```
GET /getGlobalQuote?symbol={symbol}
```

### Benzinga

#### Get Calendar Data
```
GET /getBenzingaCalendar?parameters
```

## Authentication

All API endpoints require a valid Firebase ID token in the `Authorization` header:
```
Authorization: Bearer <firebase-id-token>
```

### Getting an ID Token (Client-side)

```typescript
import { getAuth } from 'firebase/auth';

const auth = getAuth();
const idToken = await auth.currentUser?.getIdToken();
```

## CORS Configuration

The API supports CORS with the following configuration:
- **Allowed Origins**:
  - `http://localhost:4200` (development)
  - `https://av-proxy-api--alpha-vantage-proxy-api.us-central1.hosted.app` (production)
- **Allowed Methods**: `GET, POST, OPTIONS`
- **Allowed Headers**: `Content-Type, Authorization, X-API-KEY, x-debug-request`

## Deployment

### Deploy Functions
```bash
# Deploy all functions
firebase deploy --only functions

# Deploy specific function
firebase deploy --only functions:getDailyStockDataSimple
```

### Deploy Hosting
```bash
# Build Angular app
ng build --configuration production

# Deploy to Firebase Hosting
firebase deploy --only hosting
```

## Testing

### Unit Tests
```bash
# Run Angular unit tests
ng test

# Run Firebase Functions tests
cd functions
npm test
```

### End-to-End Tests
```bash
# Run Angular e2e tests
ng e2e
```

## Troubleshooting

### Common Issues

#### CORS Errors
- Ensure the request origin is in the allowed origins list
- Verify the `Authorization` header is properly formatted
- Check browser console for detailed error messages

#### Authentication Errors
- Verify the Firebase ID token is valid and not expired
- Ensure the user is properly authenticated
- Check Firebase Authentication console for user status

## Emulator HTTP Utilities

This repo includes emulator-only HTTP endpoints for manually triggering data refreshes during local development. These endpoints return 403 outside the Firebase emulators.

- Functions emulator URL template:
  - `http://localhost:5001/<projectId>/us-central1/<functionName>`

### Time-Series Refresh/Init (Alpha Vantage)

- Function: `refreshAvTimeSeriesHttp`
- File: `functions/src/v2/alpha-vantage/data-refresher/av-timeseries-http.ts`
- Query params:
  - `interval` (required): `DAILY | WEEKLY | MONTHLY`
  - `symbol` (optional): e.g., `AAPL`; omit to run for all tracked symbols
  - `init` (optional): `true` to initialize the full series if missing
  - `force` (optional): `true` to bypass freshness at the wrapper level

PowerShell one-liners (replace `<projectId>` as needed; default region is `us-central1`):

```powershell
# DAILY compact refresh for a single symbol
Invoke-RestMethod -Method GET -Uri "http://localhost:5001/<projectId>/us-central1/refreshAvTimeSeriesHttp?interval=DAILY&symbol=AAPL"

# WEEKLY full init if missing
Invoke-RestMethod -Method GET -Uri "http://localhost:5001/<projectId>/us-central1/refreshAvTimeSeriesHttp?interval=WEEKLY&symbol=AAPL&init=true"

# MONTHLY compact refresh for all tracked symbols
Invoke-RestMethod -Method GET -Uri "http://localhost:5001/<projectId>/us-central1/refreshAvTimeSeriesHttp?interval=MONTHLY"

# DAILY compact refresh with force
Invoke-RestMethod -Method GET -Uri "http://localhost:5001/<projectId>/us-central1/refreshAvTimeSeriesHttp?interval=DAILY&symbol=MSFT&force=true"
```

Response shape includes: `startedAtIso`, `finishedAtIso`, `totalDurationMs`, `processed`, `refreshed`, `initialized`, `errors`, and per-symbol details like `durationMs`, `docPath`, `latestBarIso`, `nextRefreshIso`.

### Non–Time-Series Refresh (Alpha Vantage)

- Function: `refreshAlphaVantageDataV2Http`
- File: `functions/src/v2/alpha-vantage/data-refresher/av-refresh-http.ts`

PowerShell one-liners:

```powershell
# Run once (TTL-aware)
Invoke-RestMethod -Method GET -Uri "http://localhost:5001/<projectId>/us-central1/refreshAlphaVantageDataV2Http"

# With force
Invoke-RestMethod -Method GET -Uri "http://localhost:5001/<projectId>/us-central1/refreshAlphaVantageDataV2Http?force=true"
```

## Emulator Behavior: Time-Series Trimming

To keep local datasets small, the emulator build trims AV time-series payloads in `saveAvTimeSeriesData()`:
- DAILY, WEEKLY, MONTHLY: roughly the last 1 year of bars are persisted.

Files:
- `functions/src/v2/alpha-vantage/firestore/av-firestore-helper.ts`

## Storage Layout Summary (AV Time-Series)

- Root: `symbol-data/{SYMBOL}/time-series/{provider-interval}`
  - `av-daily-adjusted`, `av-weekly-adjusted`, `av-monthly-adjusted`
- Daily: year-sharded docs
  - `.../years/{YYYY}` with compact bars array
- Weekly: year-sharded docs
  - `.../years/{YYYY}` with compact bars array
- Monthly: single aggregate doc (current implementation)
  - `.../all/data` with compact bars array

Compact Bar Fields:
- Required: `t` (ms), `d` (YYYY-MM-DD), `o`, `h`, `l`, `c`, `v`
- Adjustments: `ac` (adjusted close), `dv` (dividend amount), `sc` (split coefficient)
- Optional intraday snapshot fields (if used): `ip`, `io`, `it`

## Notes

- These HTTP endpoints are intended for local development only and will return 403 outside the emulators.
- For scheduled, automated refreshes use the cron-based functions defined in `functions/src/v2/common/function-schedules.ts` and wired in `av-refresh-manager.ts`.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgements

- [Alpha Vantage](https://www.alphavantage.co/)
- [Benzinga](https://www.benzinga.com/)
- [Firebase](https://firebase.google.com/)
- [Angular](https://angular.io/)

---

## App Hosting (Production Runtime)

This repo is configured to run the Angular app on App Hosting (Cloud Run) using a zero‑dependency Node HTTP server.

- Runtime entrypoint (configured in `firebase.json`):
  - `apphosting.run: npm run start:apphosting`
- Script (`package.json`):
  - `start:apphosting`: builds shared, builds the Angular app in production mode, then starts `server.mjs`.
- Server (`server.mjs`):
  - Serves static files from `dist/myapp`
  - Binds to `0.0.0.0:$PORT` (required by App Hosting)
  - SPA fallback to `index.html`
  - Cache headers: `index.html` is no‑cache; assets are long‑cached

### Build Order for Monorepo

To ensure the Angular app resolves `@shared/*` imports from compiled outputs:

1) Build shared first
```
npm run build:shared
```
2) Build the Angular app
```
ng build --configuration production
```
3) Local production run (uses the same runtime as App Hosting)
```
$env:PORT=8080; npm run start:apphosting
# or
PORT=8080 npm run start:apphosting
```

### TypeScript Path Mapping

The app consumes compiled shared declarations instead of raw TS sources:

- `tsconfig.json`
```json
{
  "compilerOptions": {
    "paths": {
      "@shared/*": ["shared/lib/*"]
    }
  }
}
```

This prevents the browser build from importing Node‑typed sources.

### Troubleshooting TS2688 ('node' types)

If you see:
```
error TS2688: Cannot find type definition file for 'node'.
```
Check the following:

- App (browser) build should not include Node types
  - `tsconfig.app.json`: do NOT specify `"types": ["node"]`.
- Shared library should not force Node types into the app
  - `shared/tsconfig.json`: do NOT specify `"types": ["node"]`.
- Path mapping must point to compiled outputs
  - `tsconfig.json`: `"@shared/*": ["shared/lib/*"]`.
- Functions require Node types at build time
  - `functions/package.json`: `@types/node` is in `dependencies` (not just `devDependencies`).
- App Hosting runtime should build shared before building the app
  - `package.json` → `start:apphosting` runs `npm run build:shared` first.

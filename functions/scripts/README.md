# Alpha Vantage Proxy API - Test Scripts

Test scripts for the Alpha Vantage Proxy API.

## test-symbol-search.ts

Tests the SYMBOL_SEARCH endpoint against both emulator and production environments.

### Key Features

- Test against local emulator or production
- Compare raw vs processed API responses
- Automatic best symbol selection for Firestore
- Detailed request/response logging

### Symbol Selection Logic

1. Prefers US-based symbols with highest match score
2. Falls back to highest scoring global symbol if no US match
3. Saves selected symbol to Firestore with metadata

### Prerequisites

1. Node.js (v14+)
2. Firebase CLI installed and authenticated
3. Alpha Vantage API key in `.env.alpha-vantage-proxy-api`

### Setup

1. Create `.env.alpha-vantage-proxy-api` in `functions`:

```env
LOCAL_EMULATOR_ALPHAVANTAGE_API_KEY=your_alpha_vantage_api_key
GCLOUD_PROJECT=your-firebase-project-id
ALPHA_VANTAGE_API_KEY=your_alpha_vantage_api_key
```

2. Install dependencies:
```bash
cd functions
npm install
```

### Usage

```bash
# Basic usage (emulator)
npx ts-node scripts/test-symbol-search.ts "walmart"

# Production test
npx ts-node scripts/test-symbol-search.ts --prod "walmart"

# Debug mode (shows raw responses)
npx ts-node scripts/test-symbol-search.ts --debug "walmart"
```

### Output

1. **RAW ALPHA VANTAGE RESPONSE**
   - Direct API response with all matches

2. **FIREBASE FUNCTION RESPONSE**
   - Processed response with selected symbol
   - Includes selection reason

For each section, you'll see:
- Request URL
- HTTP Status
- Duration
- Response body

### Troubleshooting

- **No matches**: Check API key and network
- **API errors**: Verify rate limits and key permissions
- **Firestore issues**: Ensure emulator is running for local tests

### Notes
- The script automatically handles URL encoding of search terms
- In production mode, the script makes actual API calls to your deployed Firebase functions
- The debug flag (`--debug`) shows the raw API responses for comparison
- All matches are returned in the API response, but only the best match is saved to Firestore
- Test script automatically handles symbol deduplication
- Results are cached based on TTL
- Firestore writes are idempotent

---

## test-save-tracked-symbol.ts

Tests the `saveTrackedSymbol` callable function by sending a test symbol object and verifying that it is correctly saved to Firestore. This script is designed to run against the local Firebase emulator.

### Key Features

-   Tests the `saveTrackedSymbol` cloud function directly.
-   Uses `axios` to simulate a client-side request to the local function emulator.
-   Constructs a sample `TrackedSymbol` object for the test.
-   Verifies that the data is successfully written to the Firestore emulator.
-   Provides clear logging for the function call and the Firestore verification step.

### Prerequisites

The prerequisites are the same as for `test-symbol-search.ts`. Ensure you have Node.js, Firebase CLI, and a configured `.env.alpha-vantage-proxy-api` file.

### Setup

Setup is the same as for `test-symbol-search.ts`.

### Usage

The script requires a symbol to be passed as a command-line argument.

```bash
# Basic usage (runs against the emulator)
npx ts-node scripts/test-save-tracked-symbol.ts GOOGL

# With debug flag (currently for logging purposes)
npx ts-node scripts/test-save-tracked-symbol.ts MSFT --debug
```

**Note:** The `--prod` flag is recognized but not implemented for this script. It will default to running against the emulator.

### Output

The script provides the following output:

1.  **Function Response**: The JSON response from the `saveTrackedSymbol` function call.
2.  **Firestore Verification**: A confirmation message and the full document data as it was saved in Firestore.

### Troubleshooting

-   **Connection Refused**: Ensure the Firebase emulators (especially Functions and Firestore) are running. You can start them with `firebase emulators:start`.
-   **Authentication Errors**: The script sends a mock `Authorization` header. If your function's security rules are stricter, you may need to provide a valid test token.
-   **Document Not Found**: Check the Firestore emulator UI to see if any data was written and verify the collection/document names match.

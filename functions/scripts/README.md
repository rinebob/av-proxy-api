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

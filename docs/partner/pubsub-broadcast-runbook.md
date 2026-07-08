# Manual Human Runbook — `partner-symbol-added`

This runbook contains the exact commands needed to add, test, and troubleshoot the `partner-symbol-added` Pub/Sub channel.

For the broader broadcast architecture guide and payload contract, see `@c:\aa\projects\av-proxy-api\docs\partner\pubsub-broadcast-developer-guide.md`.

---

## D.1 Prerequisites

- `gcloud` CLI installed and authenticated.
- `firebase` CLI installed and authenticated.
- A valid Alpha Vantage API key configured as a Firebase secret in the producer project.
- Access to deploy Cloud Functions in both projects.

## D.2 Producer setup

1. Set project:

   ```bash
   PRODUCER_PROJECT_ID="alpha-vantage-proxy-api"
   gcloud config set project "$PRODUCER_PROJECT_ID"
   ```

2. Enable Pub/Sub:

   ```bash
   gcloud services enable pubsub.googleapis.com
   ```

3. Create the topic:

   ```bash
   gcloud pubsub topics create partner-symbol-added \
     --project="$PRODUCER_PROJECT_ID"
   ```

4. Verify the topic exists:

   ```bash
   gcloud pubsub topics describe partner-symbol-added \
     --project="$PRODUCER_PROJECT_ID"
   ```

5. Grant the producer runtime SA publisher permission:

   ```bash
   PRODUCER_PROJECT_NUMBER=$(gcloud projects describe "$PRODUCER_PROJECT_ID" --format='value(projectNumber)')
   SA_PUBLISHER="${PRODUCER_PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

   gcloud pubsub topics add-iam-policy-binding \
     "projects/${PRODUCER_PROJECT_ID}/topics/partner-symbol-added" \
     --member="serviceAccount:${SA_PUBLISHER}" \
     --role="roles/pubsub.publisher" \
     --project="$PRODUCER_PROJECT_ID"
   ```

6. Deploy the producer functions:

   ```bash
   cd c:/aa/projects/av-proxy-api/functions
   firebase deploy --only functions --project "$PRODUCER_PROJECT_ID"
   ```

## D.3 Consumer setup

1. Set project:

   ```bash
   CONSUMER_PROJECT_ID="rel-str"
   gcloud config set project "$CONSUMER_PROJECT_ID"
   ```

2. Enable required APIs:

   ```bash
   gcloud services enable cloudfunctions.googleapis.com
   gcloud services enable eventarc.googleapis.com
   gcloud services enable run.googleapis.com
   gcloud services enable pubsub.googleapis.com
   ```

3. Grant deployment identity Eventarc and Run permissions:

   ```bash
   gcloud projects add-iam-policy-binding "$CONSUMER_PROJECT_ID" \
     --member="user:you@your-domain.com" \
     --role="roles/eventarc.admin"

   gcloud projects add-iam-policy-binding "$CONSUMER_PROJECT_ID" \
     --member="user:you@your-domain.com" \
     --role="roles/run.admin"

   gcloud iam service-accounts add-iam-policy-binding \
     "${CONSUMER_PROJECT_ID}@appspot.gserviceaccount.com" \
     --member="user:you@your-domain.com" \
     --role="roles/iam.serviceAccountUser" \
     --project="$CONSUMER_PROJECT_ID"
   ```

4. Deploy the consumer function from Appendix C of the developer guide:

   ```bash
   cd /path/to/consumer/project
   firebase deploy --only "functions:processSymbolAdded" --project "$CONSUMER_PROJECT_ID"
   ```

5. Grant the consumer Eventarc SA subscriber access to the producer topic:

   ```bash
   CONSUMER_PROJECT_NUMBER=$(gcloud projects describe "$CONSUMER_PROJECT_ID" --format='value(projectNumber)')
   SA_EVENTARC="service-${CONSUMER_PROJECT_NUMBER}@gcp-sa-eventarc.iam.gserviceaccount.com"

   gcloud pubsub topics add-iam-policy-binding \
     "projects/${PRODUCER_PROJECT_ID}/topics/partner-symbol-added" \
     --member="serviceAccount:${SA_EVENTARC}" \
     --role="roles/pubsub.subscriber" \
     --project="$PRODUCER_PROJECT_ID"
   ```

## D.4 End-to-end test

1. Choose a symbol and add it through the symbol manager or bulk import:

   ```bash
   SYMBOL="AVGO"
   ```

2. Create a `tracked-symbols/{SYMBOL}` document. The easiest manual path is the `saveTrackedSymbol` callable function, but you can also write the document directly in the Firebase Console.

3. Watch the `onSymbolAdded` function logs in the producer project:

   ```bash
   gcloud functions logs read onSymbolAdded --project="$PRODUCER_PROJECT_ID" --limit=50
   ```

   You should see lines indicating DAILY, WEEKLY, and MONTHLY success, followed by a log line that the `partner-symbol-added` message was published.

4. Verify the message was published by checking the consumer function logs:

   ```bash
   gcloud functions logs read processSymbolAdded --project="$CONSUMER_PROJECT_ID" --limit=50
   ```

   You should see the decoded payload with the symbol and `availableIntervals`.

5. Inspect the topic directly without a consumer:

   ```bash
   gcloud pubsub topics publish "projects/${PRODUCER_PROJECT_ID}/topics/partner-symbol-added" \
     --message='{"version":"v1","symbols":["TEST"],"addedAtUTC":"2026-07-08T20:30:00.000Z","status":"ready","availableIntervals":["daily","weekly","monthly"]}' \
     --attribute="status=ready" \
     --attribute="version=v1" \
     --attribute="symbol=TEST" \
     --project="$PRODUCER_PROJECT_ID"
   ```

   Then confirm the consumer function processed the test message.

## D.5 Local emulator test

1. Start the Firebase emulator suite:

   ```bash
   cd c:/aa/projects/av-proxy-api/functions
   firebase emulators:start --only functions,firestore,pubsub --project "$PRODUCER_PROJECT_ID"
   ```

2. In another shell, create a tracked-symbol document:

   ```bash
   curl -X POST "http://localhost:5001/${PRODUCER_PROJECT_ID}/us-central1/saveTrackedSymbol" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer owner" \
     -d "{\"data\":{\"symbol\":\"${SYMBOL}\",\"name\":\"${SYMBOL} Test\",\"type\":\"Equity\",\"region\":\"US\",\"marketOpen\":\"09:30\",\"marketClose\":\"16:00\",\"timezone\":\"UTC-05:00\",\"currency\":\"USD\",\"matchScore\":\"1.0\"}}"
   ```

3. Observe the emulator Pub/Sub output. The publisher will auto-create the `partner-symbol-added` topic if it does not exist.

## D.6 Troubleshooting

- **Topic not found in emulator**: the publisher auto-creates it on first `publishMessage`; if creation races, the second retry in `symbol-added.publisher.ts` handles it.
- **Consumer not receiving messages**: verify `roles/pubsub.subscriber` is granted to the consumer Eventarc service agent on the producer topic, not on a consumer-project topic.
- **Function deploy fails with IAM error**: ensure your user account has `roles/eventarc.admin`, `roles/run.admin`, and `roles/iam.serviceAccountUser` in the consumer project.
- **Missing symbol data**: check that `onSymbolAdded` logs show `daily=true weekly=true monthly=true`; if any interval failed, no `partner-symbol-added` message is emitted and the function returns `success: false`.

---
trigger: always_on
---

# Project Plan: Transition to a Firestore-Backed Data Service

## Overview

We are modifying our project to extend the current application into a robust, self-sustaining service. This service will maintain a real-time, constantly updated Firestore database of financial data for consumption by other client applications. Client applications will no longer make direct requests to Alpha Vantage (AV) or Benzinga (BZ) APIs; instead, they will always fetch data directly from this centralized database. The existing project will be extended to support keeping this database up to date. Each AV/BZ endpoint will have a specified Time-to-Live (TTL), and upon its expiration, a new request for that endpoint's data will be made, and a Cloud Function will write this new data to the database. This ensures the database always has fresh data and mitigates concerns about API rate limits for end-users.

This service will maintain a global list of symbols, which will be an aggregation of all symbols saved by all users across client applications. Whenever a TTL for a particular symbol/endpoint combination expires, a new request for that symbol/endpoint will be sent, and the updated data will be written to the Firestore database.

## API Endpoints and Recommended TTLs

Here is a list of all the Alpha Vantage and Benzinga endpoints we will manage, along with their recommended cache TTLs:

| API Provider  | Endpoint                                   | Description/Purpose                                                | Recommended Cache TTL              |
| :------------ | :----------------------------------------- | :----------------------------------------------------------------- | :--------------------------------- |
| Benzinga      | Future Earnings Dates & Results (REVISED)  | Real-time actual earnings results post-announcement. Can supplement AV for deeper estimates. | 1-4 hours (pre-release), Indefinite (post-actual) |
| Benzinga      | Analyst Ratings                            | Analyst upgrades, downgrades, price targets.                       | 24-72 hours                        |
| Benzinga      | Analyst Insights                           | Commentary behind analyst ratings.                                 | 24-72 hours                        |
| Benzinga      | Insider Trades API                         | Detailed insider trading data.                                     | 24 hours (recent), 7 days (historical) |
| Benzinga      | Economic Calendar API                      | Dates and outcomes of economic data releases.                      | 24 hours (future), Indefinite (actuals) |
| Benzinga      | Signals: Unusual Options                   | Detection of large or unusual options trades.                      | 1-5 minutes (trading hours)        |
| Benzinga      | Trending Tickers                           | Tickers gaining significant retail/institutional attention.        | 15 min - 1 hour (trading hours)    |
| Benzinga      | Mergers & Acquisitions Deals               | M&A activity data.                                                 | 24 hours - 7 days                  |
| Benzinga      | Upcoming & Historical Dividends            | Dividend announcements/changes.                                    | 24 hours - 7 days (recent), Indefinite (historical) |
| Alpha Vantage | TIME_SERIES_INTRADAY                       | Granular OHLCV data (1min, 5min, etc.).                            | 1-5 minutes (current day), Indefinite (historical) |
| Alpha Vantage | TIME_SERIES_DAILY_ADJUSTED                 | End-of-day adjusted OHLCV data.                                    | 24 hours (refresh daily)           |
| Alpha Vantage | GLOBAL_QUOTE                               | Current single snapshot quote.                                     | 10-30 seconds                      |
| Alpha Vantage | COMPANY_OVERVIEW                           | Fundamental company data (sector, industry, ratios).               | 7 days - 1 month (static), Quarterly (dynamic ratios) |
| Alpha Vantage | SYMBOL_SEARCH                              | Utility to search for tickers by keyword.                          | Indefinite or 1 month              |
| Alpha Vantage | SECTOR                                     | Real-time/historical sector performance.                           | 5-15 minutes (trading hours)       |
| Alpha Vantage | NEWS_SENTIMENT                             | News articles and sentiment scores.                                | 5 min - 1 hour (recent), Indefinite (historical sentiment) |
| Alpha Vantage | SMA Trending / EMA Trending / OBV Trending (Technical Indicators) | Technical indicator values.                                        | 1-5 minutes (intraday), 24 hours (daily) |
| Alpha Vantage | INSIDER_TRANSACTIONS                       | Insider buying/selling summaries.                                  | 24 hours (recent), 7 days (older)  |
| Alpha Vantage | Economic Indicators (e.g., GDP, CPI)       | Macroeconomic data.                                                | Indefinite (historical), 1 day - 1 week (most recent) |
| Alpha Vantage | Treasury Yield / Federal Funds Rate        | Interest rate data.                                                | 24 hours                           |
| Alpha Vantage | Income Statement, Balance Sheet, Cash Flow | Quarterly and annual financial statements.                         | Indefinite (after release), refresh quarterly |
| Alpha Vantage | EARNINGS (Historical EPS)                  | Historical quarterly and annual earnings reports.                  | Indefinite (after release), refresh quarterly |
| Alpha Vantage | EARNINGS_CALENDAR (NEW/PRIMARY)            | Broad list of upcoming company earnings (3, 6, 12 months).         | 7 days - 1 month                   |
| Alpha Vantage | IPO_CALENDAR                               | Upcoming and recent IPOs.                                          | 1 day - 1 week                     |
| Alpha Vantage | OPTIONS_CHAIN (Realtime)                   | Live options chain data (Greeks, IV).                              | 10-30 seconds                      |
| Alpha Vantage | HISTORICAL_OPTIONS                         | Historical options data, including historical IV.                  | Indefinite                         |
| Alpha Vantage | TOP_GAINERS_LOSERS                         | Daily top/worst-performing stocks.                                 | 5-15 minutes (trading hours)       |

---

## Core Architectural Components

* **Centralized Firestore Database:** This will be the single source of truth for all client applications. It will store data from Alpha Vantage and Benzinga, as well as the metadata required to manage its freshness.
* **Data Maintainer Functions:** A new, dedicated suite of Cloud Functions responsible for the entire data lifecycle: managing symbols, fetching data from external APIs, and writing it to Firestore.
* **Automated Scheduling System:** We'll use a combination of Cloud Scheduler, Pub/Sub, and Cloud Tasks to create a resilient, automated system that triggers data refreshes based on the Time-to-Live (TTL) you've defined for each endpoint.

---

## Phased Implementation Plan

We will implement this in four distinct phases to ensure a smooth and organized development process. We will create a new directory, `functions/src/data-maintainer`, to house all the new logic, keeping it cleanly separated from the existing functions.

### Phase 1: Foundation - Firestore Schema & Symbol Management

This phase focuses on setting up the database structure and the entry point for managing the list of symbols to track.

#### Task 1.1: Design Firestore Schema

We will define two primary root collections:

* `tracked_symbols`: A collection to store the global list of symbols this service is responsible for. Each document could represent a symbol (e.g., `/tracked_symbols/AAPL`).
* `market_data`: A collection to store the actual API data. We'll structure it for efficient querying, for example: `/market_data/{symbol}/data_points/{endpoint_name}`. Each document in `market_data` will contain the fetched data payload, plus metadata fields: `lastUpdated`, `ttlSeconds`, and `nextRefreshAt`.

#### Task 1.2: Implement `symbolManager` Cloud Function

Create a new, secure HTTP-triggered Cloud Function.

* **Purpose:** This will be the sole endpoint for your client applications to interact with this service, allowing them to add or remove symbols from the `tracked_symbols` collection.
* **Action:** When a new symbol is added, this function will also pre-populate its required entries in the `market_data` collection, setting them up for their first fetch.

### Phase 2: Core Logic - Data Fetching & Storage

This phase involves building the machinery to communicate with the third-party APIs and save the results.

#### Task 2.1: Create Centralized API Client Services

Drawing from the logic in `getGlobalQuote.ts`, we will create reusable TypeScript classes or modules for the Alpha Vantage and Benzinga APIs.

* **Purpose:** These clients will encapsulate all the logic for making `fetch` requests, handling API keys via secrets, and parsing responses. This avoids code duplication and makes maintenance easier.

#### Task 2.2: Implement `fetchAndStoreData` Cloud Function

Create a new Cloud Function that will be triggered internally (by the scheduler we build in Phase 3).

* **Purpose:** This function will be the workhorse of the system.
* **Action:** It will receive a `{ symbol, endpoint }` payload, use the appropriate API client from Task 2.1 to get fresh data, transform it into our defined schema, and write it to the correct document in the `market_data` collection in Firestore. It will also calculate and set the `nextRefreshAt` timestamp based on the endpoint's TTL.

### Phase 3: Automation - Scheduling & Refresh Triggering

This is the most critical phase, where we automate the entire data refresh process.

#### Task 3.1: Configure a `refreshDispatcher` Cloud Function

Create a Pub/Sub-triggered Cloud Function that runs on a schedule (e.g., every minute) via a Cloud Scheduler job.

* **Purpose:** To find all data points that need refreshing.
* **Action:** It will query the `market_data` collection for all documents where the `nextRefreshAt` timestamp is in the past.

#### Task 3.2: Integrate Cloud Tasks for Reliable Execution

For every expired document found by the `refreshDispatcher`, it won't call the fetcher directly. Instead, it will create a task and push it to a Cloud Task Queue.

* **Purpose:** This makes the system incredibly robust. Cloud Tasks provides automatic retries, rate-limiting, and ensures that even if the dispatcher function times out or fails, the refresh jobs are not lost.
* The `fetchAndStoreData` function (from Task 2.2) will be configured as the handler for this task queue.

### Phase 4: Configuration, Security, and Deployment

The final phase is to tie everything together, secure it, and deploy.

#### Task 4.1: Create Endpoint Configuration

We'll create a central configuration file (`config.ts`) within the `data-maintainer` directory.

* **Purpose:** This file will map each endpoint name (e.g., `GLOBAL_QUOTE`) to its specific TTL, as you've provided. This makes it easy to adjust TTLs in the future without changing code.

#### Task 4.2: Secure Firestore with Rules

We will write new Firestore security rules.

* **Rules:**
    * Client applications (authenticated users) will have read-only access to the `market_data` collection.
    * Only the `symbolManager` function will be able to write to the `tracked_symbols` collection.
    * All other write access to `market_data` will be locked down to the backend service account only, preventing any unauthorized modifications.

#### Task 4.3: Deploy & Monitor

Deploy all the new functions, the scheduler, and the Firestore rules.

* Set up logging and monitoring to observe the system's health, ensuring tasks are being dispatched and exec
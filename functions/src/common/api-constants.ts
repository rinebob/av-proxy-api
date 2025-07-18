/**
 * API-related constants used across the application
 */

export const API_CONSTANTS = {
  ALPHA_VANTAGE: {
    BASE_URL: 'https://www.alphavantage.co/query',
    DEFAULT_TIMEOUT_MS: 30000, // Increased from 15000 to 30000 (30 seconds)
    RESPONSE_TYPE: 'json' as const
  }
} as const;

export type ApiConstants = typeof API_CONSTANTS;

import { onRequest } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { defineSecret } from 'firebase-functions/params';
import { ApiClient } from './api/api-client';
import { AlphaVantageEndpoint } from './common/common-av';
import { BenzingaEndpoint } from './api/common/enums';
import axios from 'axios';

// Define the secrets using firebase-functions/params
const alphaVantageApiKeyParam = defineSecret('ALPHAVANTAGE_API_KEY');
const benzingaApiKeyParam = defineSecret('BENZINGA_CALENDAR_API_KEY');

// For local emulator
const localEmulatorAlphaVantageApiKey = defineString('LOCAL_EMULATOR_ALPHAVANTAGE_API_KEY', {
  input: { text: {} },
  default: '',
  description: 'API key for Alpha Vantage, ONLY for local emulator use.'
});

const localEmulatorBenzingaApiKey = defineString('LOCAL_EMULATOR_BENZINGA_CALENDAR_API_KEY', {
  input: { text: {} },
  default: '',
  description: 'API key for Benzinga Calendar API, ONLY for local emulator use.'
});

// Export the Firebase Cloud Function
export const testEndpoints = onRequest(
  {
    secrets: [alphaVantageApiKeyParam, benzingaApiKeyParam],
    cors: true,
  },
  async (req, res) => {
    console.log('=== Starting testEndpoints function ===');
    
    try {
      // Get API keys based on environment
      const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
      console.log(`Running in ${isEmulator ? 'emulator' : 'production'} mode`);
      
      const alphaVantageKey = isEmulator 
        ? localEmulatorAlphaVantageApiKey.value() 
        : alphaVantageApiKeyParam.value();
        
      const benzingaKey = isEmulator
        ? localEmulatorBenzingaApiKey.value()
        : benzingaApiKeyParam.value();

      // Debug log the keys (without logging the actual values)
      console.log('Alpha Vantage key configured:', !!alphaVantageKey);
      console.log('Benzinga key configured:', !!benzingaKey);

      // Validate API keys
      if (!alphaVantageKey) throw new Error('Alpha Vantage API key is not configured');
      if (!benzingaKey) throw new Error('Benzinga API key is not configured');

      // Initialize API clients
      console.log('Initializing API clients...');
      const avClient = new ApiClient();
      
      // Test Alpha Vantage endpoints
      console.log('Testing Alpha Vantage endpoints...');
      const [globalQuote, dailyTimeSeries] = await Promise.all([
        avClient.fetchAlphaVantage(AlphaVantageEndpoint.GLOBAL_QUOTE, { symbol: 'IBM' })
          .catch(error => {
            console.error('Error in GLOBAL_QUOTE:', error);
            return { data: null };
          }),
        avClient.fetchAlphaVantage(AlphaVantageEndpoint.TIME_SERIES_DAILY, { 
          symbol: 'IBM',
          outputsize: 'compact' 
        }).catch(error => {
          console.error('Error in TIME_SERIES_DAILY:', error);
          return { data: null };
        })
      ]);

      // Test Benzinga endpoint with enhanced logging
      console.log('Testing Benzinga endpoint...');
      const today = new Date().toISOString().split('T')[0];
      
      const benzingaParams = {
        tickers: ['AAPL'],
        date: today,
        date_from: today,
        date_to: today,
        page: '0',
        page_size: '10',
        display_output: 'full',
        pagesize: '10',
        token: benzingaKey
      };
      
      console.log('Benzinga request params:', JSON.stringify(benzingaParams, null, 2));
      console.log(`Benzinga API key starts with: ${benzingaKey.substring(0, 5)}...`);
      
      try {
        // Construct URL with parameters in parameters[] namespace
        const url = new URL(`https://api.benzinga.com/api/v2.1/${BenzingaEndpoint.CALENDAR}/earnings`);
        
        // Add token as top-level parameter
        url.searchParams.append('token', benzingaKey);
        
        // Add pagesize as top-level parameter
        url.searchParams.append('pagesize', '10');
        
        // Add all other parameters under parameters[] namespace
        const { token, pagesize, ...params } = benzingaParams;
        Object.entries(params).forEach(([key, value]) => {
          if (value !== undefined) {
            if (Array.isArray(value)) {
              url.searchParams.append(`parameters[${key}]`, value.join(','));
            } else {
              url.searchParams.append(`parameters[${key}]`, value.toString());
            }
          }
        });
        
        console.log('Benzinga API URL:', url.toString().replace(/token=[^&]+/, 'token=REDACTED'));
        
        // Make the request with axios directly
        console.log('Making Benzinga API request...');
        const response = await axios.get(url.toString());
        console.log('Benzinga API response status:', response.status);
        console.log('Benzinga API response data:', JSON.stringify(response.data, null, 2));
        
        // Prepare successful response
        const results = {
          status: 'success',
          alphaVantage: {
            globalQuote: globalQuote?.data ? 'Data received' : 'No data',
            dailyTimeSeries: dailyTimeSeries?.data ? 'Data received' : 'No data'
          },
          benzinga: {
            status: 'success',
            data: response.data,
            statusCode: response.status
          },
          environment: isEmulator ? 'Emulator' : 'Production',
          timestamp: new Date().toISOString()
        };

        console.log('Sending successful response');
        res.status(200).json(results);
        
      } catch (error: any) {
        const errorInfo = {
          message: error?.message || 'Unknown error',
          code: error?.code,
          status: error?.response?.status,
          response: error?.response?.data ? {
            ...(error.response.data as object),
            raw: JSON.stringify(error.response.data).substring(0, 500) + '...'
          } : undefined,
          config: error?.config ? {
            url: error.config.url,
            method: error.config.method,
            headers: {
              ...(error.config.headers as object),
              'X-BZ-API-KEY': error.config.headers?.['X-BZ-API-KEY'] ? '[REDACTED]' : undefined
            }
          } : undefined
        };

        console.error('Benzinga API Error:', errorInfo);
        throw new Error(`Benzinga CALENDAR failed: ${errorInfo.message}`);
      }
      
    } catch (error) {
      console.error('Error in testEndpoints:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      res.status(500).json({
        status: 'error',
        message: errorMessage,
        timestamp: new Date().toISOString(),
        error: process.env.NODE_ENV === 'development' ? {
          name: error instanceof Error ? error.name : undefined,
          stack: error instanceof Error ? error.stack : undefined,
          ...(typeof error === 'object' ? error : {})
        } : undefined
      });
    }
  },
);

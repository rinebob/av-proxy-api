import { onRequest } from 'firebase-functions/v2/https';
import { mockDataService, registerAllMockData } from './mock-data';
import { CheckMockDataRequest, CheckMockDataResponse } from '../common/common-av';

// Initialize mock data on module load
registerAllMockData();

// Log available mock data on startup
// console.log('Available mock endpoints:', Array.from(mockDataService.getEndpoints()));
// mockDataService.getEndpoints().forEach(endpoint => {
//   console.log(`fn gE: Available symbols for ${endpoint}:`, mockDataService.getSymbols(endpoint));
// });

/**
 * Cloud Function to check if mock data is available for a given symbol and endpoint
 */
export const checkMockData = onRequest(
  { cors: true },
  async (req, res) => {
    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    // Only allow POST
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    try {
      const { symbol, endpoint } = req.body as CheckMockDataRequest;
      
      if (!symbol || !endpoint) {
        res.status(400).json({ error: 'Missing symbol or endpoint' });
        return;
      }

      console.log('fn cMD Checking mock data for:', { symbol, endpoint });
      console.log('fn cMD All registered endpoints:', Array.from(mockDataService.getEndpoints()));
      
      const hasMockData = mockDataService.has(endpoint, symbol);
      
      const response: CheckMockDataResponse = {
        hasMockData,
        symbol,
        endpoint,
        availableEndpoints: Array.from(mockDataService.getEndpoints()),
        availableSymbols: mockDataService.getSymbols(endpoint)
      };
      
      console.log('fn cMD checkMockData response:', JSON.stringify(response, null, 2));
      
      if (!hasMockData) {
        console.log('fn cMD Mock data not found. Available symbols for this endpoint:', mockDataService.getSymbols(endpoint));
      }
      console.log(`fn cMD Mock data check for ${symbol} (${endpoint}): ${hasMockData ? 'available' : 'not available'}`);
      res.status(200).json(response);
    } catch (error) {
      console.error('fn cMD Error checking mock data:', error);
      res.status(500).json({ 
        error: 'Failed to check mock data',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  }
);

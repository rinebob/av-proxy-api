import { DataMaintainerEndpoint } from '../../common/common-dm';
import { mockDataService } from './mock-data.service';
import { MOCK_COMPANY_OVERVIEW_DATA } from './company-overview.mock';

// Track if registration has been done
let isRegistered = false;

/**
 * Registers all mock data with the service
 * Safe to call multiple times - will only register once
 */
export function registerAllMockData() {
  if (isRegistered) return;
  
  // Register company overview mock data
  mockDataService.registerBulk(
    DataMaintainerEndpoint.COMPANY_OVERVIEW, 
    MOCK_COMPANY_OVERVIEW_DATA
  );
  
  // Add registration for other mock data types here
  // Example for additional endpoints:
  // mockDataService.registerBulk(DataMaintainerEndpoint.OTHER_ENDPOINT, MOCK_OTHER_DATA);
  
  isRegistered = true;
}

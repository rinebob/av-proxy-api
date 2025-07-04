import { onCall } from "firebase-functions/v2/https";
import { symbolManagerService } from "./symbolManager.service";

/**
 * Callable function to get symbol details
 * POST /getSymbolDetails (Firebase Callable Function)
 * Data: { symbol: string }
 * Returns: { exists: boolean, data?: TrackedSymbol }
 */
export const getSymbolDetails = onCall(async (request) => {
  const { symbol } = request.data;
  
  if (!symbol) {
    throw new Error('Symbol is required');
  }

  try {
    const details = await symbolManagerService.getSymbol(symbol);
    if (!details) {
      return { exists: false };
    }
    return { exists: true, data: details };
  } catch (error) {
    console.error(`Error getting details for symbol ${symbol}:`, error);
    throw new Error('Failed to get symbol details');
  }
});

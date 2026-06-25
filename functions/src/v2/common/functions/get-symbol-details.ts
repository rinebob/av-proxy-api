import { onRequest } from "firebase-functions/v2/https";
import { symbolManagerService } from "../../alpha-vantage/services/symbol-manager.service";
import { withCors } from "../../utils/cors-middleware";
import { authenticateRequest } from "../../utils/utils";
import { serializeTrackedSymbols } from "../common-dm";

/**
 * HTTP endpoint for retrieving a single tracked symbol by its symbol string.
 * GET /getSymbolDetailsV2?symbol=AAPL
 */
export const getSymbolDetailsV2 = onRequest({}, withCors(async (req, res) => {
  try {
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const user = await authenticateRequest(req, res);
    if (!user) return;

    const symbol = (req.query.symbol as string)?.trim().toUpperCase();
    if (!symbol) {
      res.status(400).json({
        ok: false,
        error: 'Symbol query parameter is required'
      });
      return;
    }

    const trackedSymbol = await symbolManagerService.getSymbol(symbol);

    if (!trackedSymbol) {
      res.status(200).json({
        ok: true,
        exists: false,
        symbol,
        data: null
      });
      return;
    }

    const [serialized] = serializeTrackedSymbols([trackedSymbol]);

    res.status(200).json({
      ok: true,
      exists: true,
      symbol,
      data: serialized
    });
  } catch (error: any) {
    console.error('gSDV2 Error in getSymbolDetailsV2:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      code: error.code,
      statusCode: error.statusCode,
      details: error.details
    });
    res.status(500).json({
      ok: false,
      error: 'gSDV2 Internal server error',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}));

import { AlphaVantageHandlerFactory } from '../../../src/v2/alpha-vantage/alpha-vantage-factory';
import { AlphaVantageEndpoint } from '@shared/alpha-vantage';
import { AvEarningsHandler } from '../../../src/v2/alpha-vantage/handlers/av-earnings.handler';
import { AvEarningsEstimatesHandler } from '../../../src/v2/alpha-vantage/handlers/av-earnings-estimates.handler';
import { AvEarningsCalendarHandler } from '../../../src/v2/alpha-vantage/handlers/av-earnings-calendar.handler';

// Mock the API key so handler constructors don't throw
process.env.ALPHAVANTAGE_API_KEY = 'test-api-key';

describe('AlphaVantageHandlerFactory — earnings endpoint registration', () => {
  describe('createHandler', () => {
    it('creates AvEarningsHandler for EARNINGS endpoint', () => {
      const handler = AlphaVantageHandlerFactory.createHandler(AlphaVantageEndpoint.EARNINGS);
      expect(handler).toBeInstanceOf(AvEarningsHandler);
    });

    it('creates AvEarningsEstimatesHandler for EARNINGS_ESTIMATES endpoint', () => {
      const handler = AlphaVantageHandlerFactory.createHandler(AlphaVantageEndpoint.EARNINGS_ESTIMATES);
      expect(handler).toBeInstanceOf(AvEarningsEstimatesHandler);
    });

    it('creates AvEarningsCalendarHandler for EARNINGS_CALENDAR endpoint', () => {
      const handler = AlphaVantageHandlerFactory.createHandler(AlphaVantageEndpoint.EARNINGS_CALENDAR);
      expect(handler).toBeInstanceOf(AvEarningsCalendarHandler);
    });

    it('throws for unregistered endpoints', () => {
      // Use an endpoint that exists in the enum but isn't in HANDLER_MAP
      expect(() => AlphaVantageHandlerFactory.createHandler(AlphaVantageEndpoint.IPO_CALENDAR)).toThrow(/No handler found/);
    });
  });
});

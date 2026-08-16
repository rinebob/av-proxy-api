import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';

import { TechnicalIndicatorsService } from './technical-indicators.service';
import { API_BASES, type ApiBases } from '../../../core/api/api.tokens';
import { HtIndicator, PriceSeries } from '@shared/alpha-vantage';
import { TimeSeriesInterval } from '@shared/alpha-vantage';

describe('TechnicalIndicatorsService', () => {
  let service: TechnicalIndicatorsService;
  let httpMock: HttpTestingController;

  const mockApiBases: ApiBases = {
    health: 'https://us-central1-test-project.cloudfunctions.net',
    av: 'https://us-central1-test-project.cloudfunctions.net',
    dm: 'https://us-central1-test-project.cloudfunctions.net',
    benzinga: 'https://us-central1-test-project.cloudfunctions.net',
    partner: 'https://us-central1-test-project.cloudfunctions.net',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASES, useValue: mockApiBases },
      ],
    });
    service = TestBed.inject(TechnicalIndicatorsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getTechnicalIndicator', () => {
    it('should construct the correct URL with query params', () => {
      service.getTechnicalIndicator({
        symbol: 'IBM',
        indicator: HtIndicator.HT_TRENDLINE,
        interval: TimeSeriesInterval.DAILY,
        series_type: PriceSeries.CLOSE,
      }).subscribe();

      const req = httpMock.expectOne(
        (r) => r.url.includes('partnerTechnicalIndicatorsV2') &&
               r.params.get('symbol') === 'IBM' &&
               r.params.get('indicator') === 'ht_trendline' &&
               r.params.get('interval') === 'daily' &&
               r.params.get('series_type') === 'close'
      );
      expect(req.request.method).toBe('GET');
      req.flush({ ok: true, data: {} });
    });

    it('should use the partner API base URL', () => {
      service.getTechnicalIndicator({
        symbol: 'AAPL',
        indicator: HtIndicator.HT_SINE,
        interval: TimeSeriesInterval.WEEKLY,
        series_type: PriceSeries.HIGH,
      }).subscribe();

      const req = httpMock.expectOne(
        (r) => r.url.startsWith(mockApiBases.partner) &&
               r.url.includes('partnerTechnicalIndicatorsV2')
      );
      req.flush({ ok: true, data: {} });
    });

    it('should return the parsed response envelope on success', () => {
      const mockResponse = {
        ok: true,
        symbol: 'IBM',
        indicator: 'ht_trendline',
        interval: 'daily',
        series_type: 'close',
        data: {
          '2025-12-08': { 'HT_TRENDLINE': '51.23' },
          '2025-12-09': { 'HT_TRENDLINE': '52.45' },
        },
        timestamp: '2025-12-09T20:00:00Z',
        processingTimeMs: 150,
      };

      service.getTechnicalIndicator({
        symbol: 'IBM',
        indicator: HtIndicator.HT_TRENDLINE,
        interval: TimeSeriesInterval.DAILY,
        series_type: PriceSeries.CLOSE,
      }).subscribe((response) => {
        expect(response.ok).toBe(true);
        expect(response.symbol).toBe('IBM');
        expect(response.indicator).toBe('ht_trendline');
        expect(response.data['2025-12-08']['HT_TRENDLINE']).toBe('51.23');
        expect(response.processingTimeMs).toBe(150);
      });

      const req = httpMock.expectOne(
        (r) => r.url.includes('partnerTechnicalIndicatorsV2')
      );
      req.flush(mockResponse);
    });

    it('should surface error message on 429 rate limit', () => {
      const errorBody = {
        ok: false,
        error: 'You have reached the API rate limit. Please try again later.',
        code: 'RATE_LIMITED',
        timestamp: '2025-12-09T20:00:00Z',
      };

      service.getTechnicalIndicator({
        symbol: 'IBM',
        indicator: HtIndicator.HT_DCPERIOD,
        interval: TimeSeriesInterval.DAILY,
        series_type: PriceSeries.CLOSE,
      }).subscribe({
        next: () => fail('should have errored'),
        error: (err) => {
          expect(err.status).toBe(429);
          expect(err.message).toContain('rate limit');
        },
      });

      const req = httpMock.expectOne(
        (r) => r.url.includes('partnerTechnicalIndicatorsV2')
      );
      req.flush(errorBody, { status: 429, statusText: 'Too Many Requests' });
    });

    it('should surface error message on 502 upstream error', () => {
      service.getTechnicalIndicator({
        symbol: 'IBM',
        indicator: HtIndicator.HT_DCPHASE,
        interval: TimeSeriesInterval.DAILY,
        series_type: PriceSeries.CLOSE,
      }).subscribe({
        next: () => fail('should have errored'),
        error: (err) => {
          expect(err.status).toBe(502);
        },
      });

      const req = httpMock.expectOne(
        (r) => r.url.includes('partnerTechnicalIndicatorsV2')
      );
      req.flush('Bad Gateway', { status: 502, statusText: 'Bad Gateway' });
    });

    it('should handle all 6 indicator types', () => {
      const indicators = [
        HtIndicator.HT_TRENDLINE,
        HtIndicator.HT_SINE,
        HtIndicator.HT_DCPERIOD,
        HtIndicator.HT_DCPHASE,
        HtIndicator.HT_TRENDMODE,
        HtIndicator.HT_PHASOR,
      ];

      indicators.forEach((indicator) => {
        service.getTechnicalIndicator({
          symbol: 'IBM',
          indicator,
          interval: TimeSeriesInterval.DAILY,
          series_type: PriceSeries.CLOSE,
        }).subscribe();

        const req = httpMock.expectOne(
          (r) => r.url.includes('partnerTechnicalIndicatorsV2') &&
                 r.params.get('indicator') === indicator
        );
        req.flush({ ok: true, data: {} });
      });
    });

    it('should handle all 4 series types', () => {
      const seriesTypes = [PriceSeries.CLOSE, PriceSeries.OPEN, PriceSeries.HIGH, PriceSeries.LOW];

      seriesTypes.forEach((series_type) => {
        service.getTechnicalIndicator({
          symbol: 'IBM',
          indicator: HtIndicator.HT_TRENDLINE,
          interval: TimeSeriesInterval.DAILY,
          series_type,
        }).subscribe();

        const req = httpMock.expectOne(
          (r) => r.url.includes('partnerTechnicalIndicatorsV2') &&
                 r.params.get('series_type') === series_type
        );
        req.flush({ ok: true, data: {} });
      });
    });

    it('should handle all 3 intervals (daily/weekly/monthly)', () => {
      const intervals = [
        TimeSeriesInterval.DAILY,
        TimeSeriesInterval.WEEKLY,
        TimeSeriesInterval.MONTHLY,
      ];

      intervals.forEach((interval) => {
        service.getTechnicalIndicator({
          symbol: 'IBM',
          indicator: HtIndicator.HT_TRENDLINE,
          interval,
          series_type: PriceSeries.CLOSE,
        }).subscribe();

        const req = httpMock.expectOne(
          (r) => r.url.includes('partnerTechnicalIndicatorsV2') &&
                 r.params.get('interval') === interval
        );
        req.flush({ ok: true, data: {} });
      });
    });
  });
});

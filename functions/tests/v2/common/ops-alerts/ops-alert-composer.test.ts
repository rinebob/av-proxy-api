import {
  composeIntradaySignoff,
  composePostSignoff,
  composeException,
} from '../../../../src/v2/common/ops-alerts/ops-alert.composer';

const DATE = '2026-10-23';

describe('composeIntradaySignoff', () => {
  it('composes a clean signoff with counts, duration, and PDR confirmation', () => {
    expect(
      composeIntradaySignoff({
        marketDate: DATE,
        clockPt: '0800',
        createdJobs: 42,
        successJobs: 42,
        permanentFailureJobs: 0,
        durationMs: 192_000,
      }),
    ).toBe(
      `Savant pipeline signoff: intraday 0800 PT run finished for market date ${DATE}. ` +
        'Refreshed 42 of 42 symbols in 3m 12s - no failures. ' +
        'Partner data-ready message sent.',
    );
  });

  it('composes a partial-failure signoff with failure count, no symbol names', () => {
    expect(
      composeIntradaySignoff({
        marketDate: DATE,
        clockPt: '1000',
        createdJobs: 42,
        successJobs: 40,
        permanentFailureJobs: 2,
        durationMs: 245_000,
      }),
    ).toBe(
      `Savant pipeline signoff: intraday 1000 PT run finished for market date ${DATE}. ` +
        'Refreshed 40 of 42 symbols in 4m 05s - 2 failed permanently; ' +
        'failed symbols are listed in the run doc and logs. ' +
        'Partner data-ready message sent.',
    );
  });

  it('derives the failure count from created - success when permanentFailureJobs is absent', () => {
    expect(
      composeIntradaySignoff({
        marketDate: DATE,
        clockPt: '0800',
        createdJobs: 10,
        successJobs: 9,
      }),
    ).toContain('1 failed permanently');
  });

  it('composes a no-work signoff when zero jobs were created', () => {
    expect(
      composeIntradaySignoff({
        marketDate: DATE,
        clockPt: '1200',
        createdJobs: 0,
        successJobs: 0,
        permanentFailureJobs: 0,
        durationMs: 3_000,
      }),
    ).toBe(
      `Savant pipeline signoff: intraday 1200 PT run finished for market date ${DATE}. ` +
        'No symbols needed refreshing. Partner data-ready message sent.',
    );
  });

  it('degrades gracefully when counts are missing', () => {
    const text = composeIntradaySignoff({ marketDate: DATE, clockPt: '0800' });
    expect(text).toBe(
      `Savant pipeline signoff: intraday 0800 PT run finished for market date ${DATE}. ` +
        'Symbol counts were not recorded. Partner data-ready message sent.',
    );
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('NaN');
  });

  it('omits the duration clause when durationMs is missing', () => {
    expect(
      composeIntradaySignoff({
        marketDate: DATE,
        clockPt: '0800',
        createdJobs: 5,
        successJobs: 5,
        permanentFailureJobs: 0,
      }),
    ).toContain('Refreshed 5 of 5 symbols - no failures.');
  });

  it('degrades gracefully when marketDate is missing', () => {
    const text = composeIntradaySignoff({ clockPt: '0800', createdJobs: 1, successJobs: 1 });
    expect(text).toContain('market date unknown');
    expect(text).not.toContain('undefined');
  });
});

describe('composePostSignoff', () => {
  it('composes a clean all-intervals signoff naming each interval', () => {
    expect(
      composePostSignoff({
        marketDate: DATE,
        sequence: 'A',
        intervals: [
          { interval: 'DAILY', createdJobs: 42, successJobs: 42, permanentFailureJobs: 0 },
          { interval: 'WEEKLY', createdJobs: 42, successJobs: 42, permanentFailureJobs: 0 },
          { interval: 'MONTHLY', createdJobs: 42, successJobs: 42, permanentFailureJobs: 0 },
        ],
      }),
    ).toBe(
      `Savant pipeline signoff: POST A run finished for market date ${DATE}. ` +
        'Refreshed daily 42/42, weekly 42/42, monthly 42/42 symbols - no failures. ' +
        'All 3 partner data-ready messages sent; scheduled work for the day is done.',
    );
  });

  it('composes a partial-failure signoff with a total failure count', () => {
    const text = composePostSignoff({
      marketDate: DATE,
      sequence: 'A',
      intervals: [
        { interval: 'DAILY', createdJobs: 42, successJobs: 42, permanentFailureJobs: 0 },
        { interval: 'WEEKLY', createdJobs: 42, successJobs: 40, permanentFailureJobs: 2 },
        { interval: 'MONTHLY', createdJobs: 42, successJobs: 41, permanentFailureJobs: 1 },
      ],
    });
    expect(text).toBe(
      `Savant pipeline signoff: POST A run finished for market date ${DATE}. ` +
        'Refreshed daily 42/42, weekly 40/42, monthly 41/42 symbols - ' +
        '3 failures total; failed symbols are listed in the run docs and logs. ' +
        'All 3 partner data-ready messages sent; scheduled work for the day is done.',
    );
  });

  it('degrades gracefully when an interval is missing counts', () => {
    const text = composePostSignoff({
      marketDate: DATE,
      intervals: [
        { interval: 'DAILY', createdJobs: 42, successJobs: 42, permanentFailureJobs: 0 },
        { interval: 'WEEKLY' },
        { interval: 'MONTHLY', createdJobs: 42, successJobs: 42, permanentFailureJobs: 0 },
      ],
    });
    expect(text).toContain('weekly counts not recorded');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('NaN');
  });

  it('defaults sequence to A when omitted', () => {
    const text = composePostSignoff({
      marketDate: DATE,
      intervals: [{ interval: 'DAILY', createdJobs: 1, successJobs: 1 }],
    });
    expect(text).toContain('POST A run');
  });

  it('degrades gracefully when intervals is empty', () => {
    const text = composePostSignoff({ marketDate: DATE, intervals: [] });
    expect(text).toContain('Interval results were not recorded');
    expect(text).not.toContain('undefined');
  });
});

describe('composeException', () => {
  it('composes a run_missing exception naming the run and where to look', () => {
    expect(
      composeException({ condition: 'run_missing', marketDate: DATE, clockPt: '0800' }),
    ).toBe(
      `Savant pipeline ALERT: the intraday 0800 PT run for market date ${DATE} never ran - ` +
        'no run doc exists. Check Cloud Scheduler and functions logs. Needs attention.',
    );
  });

  it('composes a pdr_missing exception including the run doc id when known', () => {
    expect(
      composeException({
        condition: 'pdr_missing',
        marketDate: DATE,
        sequence: 'A',
        interval: 'DAILY',
        runId: `rt-${DATE}-a-daily`,
      }),
    ).toBe(
      `Savant pipeline ALERT: the POST A DAILY run for market date ${DATE} finished ` +
        'but its partner data-ready message was never sent. ' +
        `Run doc rt-${DATE}-a-daily has details. Needs attention.`,
    );
  });

  it('composes an orchestrator_no_start exception', () => {
    expect(
      composeException({ condition: 'orchestrator_no_start', marketDate: DATE, clockPt: '1000' }),
    ).toBe(
      `Savant pipeline ALERT: the orchestrator for the intraday 1000 PT run for market date ` +
        `${DATE} never started - no jobs were created. ` +
        'Check functions logs around the scheduled tick. Needs attention.',
    );
  });

  it('omits the run-doc clause when runId is not provided', () => {
    const text = composeException({
      condition: 'pdr_missing',
      marketDate: DATE,
      clockPt: '1200',
    });
    expect(text).toContain('never sent.');
    expect(text).not.toContain('Run doc');
    expect(text).not.toContain('undefined');
  });

  it('falls back to a generic run label when neither clockPt nor sequence+interval is given', () => {
    const text = composeException({ condition: 'run_missing', marketDate: DATE });
    expect(text).toContain('the scheduled run');
  });
});

describe('SMS budget and charset', () => {
  it('keeps every representative message under ~300 chars', () => {
    const texts = [
      composeIntradaySignoff({
        marketDate: DATE, clockPt: '0800',
        createdJobs: 500, successJobs: 499, permanentFailureJobs: 1, durationMs: 3_599_000,
      }),
      composePostSignoff({
        marketDate: DATE,
        intervals: [
          { interval: 'DAILY', createdJobs: 500, successJobs: 500, permanentFailureJobs: 0 },
          { interval: 'WEEKLY', createdJobs: 500, successJobs: 498, permanentFailureJobs: 2 },
          { interval: 'MONTHLY', createdJobs: 500, successJobs: 499, permanentFailureJobs: 1 },
        ],
      }),
      composeException({ condition: 'run_missing', marketDate: DATE, clockPt: '0800' }),
      composeException({
        condition: 'pdr_missing', marketDate: DATE, sequence: 'C', interval: 'MONTHLY',
        runId: `rt-${DATE}-c-monthly`,
      }),
      composeException({ condition: 'orchestrator_no_start', marketDate: DATE, clockPt: '1200' }),
    ];
    for (const t of texts) {
      expect(t.length).toBeLessThanOrEqual(300);
    }
  });

  it('stays within GSM-7-compatible printable ASCII in every message', () => {
    // Non-ASCII characters (e.g. em dash) force UCS-2 encoding, dropping
    // SMS capacity from ~160 to ~70 chars/segment and blowing the budget.
    const texts = [
      composeIntradaySignoff({
        marketDate: DATE, clockPt: '0800',
        createdJobs: 500, successJobs: 499, permanentFailureJobs: 1, durationMs: 3_599_000,
      }),
      composePostSignoff({
        marketDate: DATE,
        intervals: [
          { interval: 'DAILY', createdJobs: 500, successJobs: 500, permanentFailureJobs: 0 },
          { interval: 'WEEKLY', createdJobs: 500, successJobs: 498, permanentFailureJobs: 2 },
          { interval: 'MONTHLY', createdJobs: 500, successJobs: 499, permanentFailureJobs: 1 },
        ],
      }),
      composeException({ condition: 'run_missing', marketDate: DATE, clockPt: '0800' }),
      composeException({
        condition: 'pdr_missing', marketDate: DATE, sequence: 'C', interval: 'MONTHLY',
        runId: `rt-${DATE}-c-monthly`,
      }),
      composeException({ condition: 'orchestrator_no_start', marketDate: DATE, clockPt: '1200' }),
    ];
    for (const t of texts) {
      expect(t).toMatch(/^[\x20-\x7E]+$/);
    }
  });

  it('keeps signoffs free of runIds and log jargon', () => {
    const intraday = composeIntradaySignoff({
      marketDate: DATE, clockPt: '0800',
      createdJobs: 42, successJobs: 42, permanentFailureJobs: 0, durationMs: 60_000,
    });
    const post = composePostSignoff({
      marketDate: DATE,
      intervals: [{ interval: 'DAILY', createdJobs: 42, successJobs: 42 }],
    });
    for (const t of [intraday, post]) {
      expect(t).not.toContain('rt-');
      expect(t).not.toMatch(/runId|event=|level=|messageSent|Firestore/i);
    }
  });

  it('handles large failure counts within budget', () => {
    const text = composeIntradaySignoff({
      marketDate: DATE, clockPt: '0800',
      createdJobs: 500, successJobs: 387, permanentFailureJobs: 113, durationMs: 3_599_000,
    });
    expect(text).toContain('113 failed permanently');
    expect(text.length).toBeLessThanOrEqual(300);
  });
});

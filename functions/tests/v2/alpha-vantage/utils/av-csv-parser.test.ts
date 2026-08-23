import { parseCsv } from '../../../../src/v2/alpha-vantage/utils/av-csv-parser.utils';

describe('parseCsv', () => {
  describe('real AV EARNINGS_CALENDAR 12-month sample', () => {
    const realSample = `symbol,name,reportDate,estimate,timeOfTheDay,exchange,fiscalDateEnding
AAPL,Apple Inc,2026-09-30,,before open,US,2026-09-30
MSFT,Microsoft Corp,2026-10-23,1.85,after close,US,2026-10-31
GOOGL,Alphabet Inc,2026-10-29,,time not supplied,US,2026-09-30
TSLA,Tesla Inc,2026-10-22,0.75,after close,US,2026-09-30
NVDA,NVIDIA Corp,2026-11-19,0.74,after close,US,2026-10-31
META,Meta Platforms Inc,2026-10-30,3.12,before open,US,2026-09-30
AMZN,Amazon.com Inc,2026-10-30,0.58,after close,US,2026-09-30
NFLX,Netflix Inc,2026-10-17,5.12,after close,US,2026-09-30`;

    it('parses correct number of data rows (excluding header)', () => {
      const rows = parseCsv(realSample);
      // parseCsv returns all rows including header; data rows = total - 1
      expect(rows.length).toBe(9); // 1 header + 8 data
    });

    it('parses header row correctly', () => {
      const rows = parseCsv(realSample);
      expect(rows[0]).toEqual([
        'symbol', 'name', 'reportDate', 'estimate', 'timeOfTheDay', 'exchange', 'fiscalDateEnding',
      ]);
    });

    it('parses first data row correctly', () => {
      const rows = parseCsv(realSample);
      expect(rows[1]).toEqual([
        'AAPL', 'Apple Inc', '2026-09-30', '', 'before open', 'US', '2026-09-30',
      ]);
    });

    it('parses row with estimate value correctly', () => {
      const rows = parseCsv(realSample);
      expect(rows[2]).toEqual([
        'MSFT', 'Microsoft Corp', '2026-10-23', '1.85', 'after close', 'US', '2026-10-31',
      ]);
    });
  });

  describe('empty fields', () => {
    it('returns empty strings for empty estimate and timeOfTheDay fields', () => {
      const input = `symbol,estimate,timeOfTheDay
AAPL,,before open
MSFT,1.85,`;
      const rows = parseCsv(input);
      expect(rows[1]).toEqual(['AAPL', '', 'before open']);
      expect(rows[2]).toEqual(['MSFT', '1.85', '']);
    });

    it('preserves empty fields in the middle of a row', () => {
      const input = `a,b,c,d
1,,3,4`;
      const rows = parseCsv(input);
      expect(rows[1]).toEqual(['1', '', '3', '4']);
    });

    it('preserves empty field at end of row', () => {
      const input = `a,b,c
1,2,`;
      const rows = parseCsv(input);
      expect(rows[1]).toEqual(['1', '2', '']);
    });
  });

  describe('headers-only input', () => {
    it('returns just the header row (no data rows)', () => {
      const input = `symbol,name,reportDate,estimate,timeOfTheDay,exchange,fiscalDateEnding`;
      const rows = parseCsv(input);
      expect(rows.length).toBe(1);
      expect(rows[0]).toEqual([
        'symbol', 'name', 'reportDate', 'estimate', 'timeOfTheDay', 'exchange', 'fiscalDateEnding',
      ]);
    });

    it('handles headers-only with trailing newline', () => {
      const input = `symbol,name,reportDate\n`;
      const rows = parseCsv(input);
      expect(rows.length).toBe(1);
      expect(rows[0]).toEqual(['symbol', 'name', 'reportDate']);
    });
  });

  describe('quoted fields with embedded commas', () => {
    it('parses quoted field with embedded comma', () => {
      const input = `symbol,name,reportDate
AAPL,"Apple, Inc",2026-09-30`;
      const rows = parseCsv(input);
      expect(rows[1]).toEqual(['AAPL', 'Apple, Inc', '2026-09-30']);
    });

    it('parses multiple quoted fields with embedded commas in same row', () => {
      const input = `a,b,c
"x,y","z,w",normal`;
      const rows = parseCsv(input);
      expect(rows[1]).toEqual(['x,y', 'z,w', 'normal']);
    });

    it('parses quoted field at end of row', () => {
      const input = `a,b
1,"hello, world"`;
      const rows = parseCsv(input);
      expect(rows[1]).toEqual(['1', 'hello, world']);
    });

    it('parses quoted field at start of row', () => {
      const input = `a,b
"hello, world",2`;
      const rows = parseCsv(input);
      expect(rows[1]).toEqual(['hello, world', '2']);
    });

    it('parses empty quoted field', () => {
      const input = `a,b,c
1,"",3`;
      const rows = parseCsv(input);
      expect(rows[1]).toEqual(['1', '', '3']);
    });

    it('parses escaped double quotes inside quoted field', () => {
      const input = `a,b
1,"He said ""hello"" world"`;
      const rows = parseCsv(input);
      expect(rows[1]).toEqual(['1', 'He said "hello" world']);
    });
  });

  describe('trailing newline handling', () => {
    it('does not produce empty trailing row with single trailing newline', () => {
      const input = `a,b\n1,2\n`;
      const rows = parseCsv(input);
      expect(rows.length).toBe(2); // header + 1 data row, no empty trailing
      expect(rows[1]).toEqual(['1', '2']);
    });

    it('does not produce empty trailing row with Windows CRLF', () => {
      const input = `a,b\r\n1,2\r\n`;
      const rows = parseCsv(input);
      expect(rows.length).toBe(2);
      expect(rows[1]).toEqual(['1', '2']);
    });

    it('handles no trailing newline', () => {
      const input = `a,b\n1,2`;
      const rows = parseCsv(input);
      expect(rows.length).toBe(2);
      expect(rows[1]).toEqual(['1', '2']);
    });
  });

  describe('edge cases', () => {
    it('handles single row with no newline', () => {
      const input = `a,b,c`;
      const rows = parseCsv(input);
      expect(rows.length).toBe(1);
      expect(rows[0]).toEqual(['a', 'b', 'c']);
    });

    it('handles empty input', () => {
      const rows = parseCsv('');
      expect(rows).toEqual([]);
    });

    it('handles whitespace-only input', () => {
      const rows = parseCsv('   \n  \n');
      // Whitespace-only lines produce rows with whitespace values
      expect(rows.length).toBe(2);
      expect(rows[0]).toEqual(['   ']);
      expect(rows[1]).toEqual(['  ']);
    });

    it('handles single-column CSV', () => {
      const input = `symbol\nAAPL\nMSFT`;
      const rows = parseCsv(input);
      expect(rows.length).toBe(3);
      expect(rows[0]).toEqual(['symbol']);
      expect(rows[1]).toEqual(['AAPL']);
      expect(rows[2]).toEqual(['MSFT']);
    });
  });
});

/**
 * Hand-rolled CSV parser for Alpha Vantage CSV responses (e.g. EARNINGS_CALENDAR).
 *
 * No external library. Handles:
 * - Standard comma-delimited rows
 * - Quoted fields (defensive — handles embedded commas inside quotes)
 * - Empty fields (returns empty string)
 * - Headers-only input (returns array with just the header row)
 * - Trailing newline at end of input (no empty trailing row)
 *
 * Interface: parseCsv(input: string): string[][] — returns array of rows,
 * each row an array of field values. First row is headers.
 */

/**
 * Parses a CSV string into a 2D array of string values.
 *
 * @param input Raw CSV text (may include trailing newline)
 * @returns Array of rows, each row an array of field values. Empty input returns [].
 */
export function parseCsv(input: string): string[][] {
  if (!input || input.length === 0) {
    return [];
  }

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < input.length) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        // Check for escaped quote ("")
        if (i + 1 < input.length && input[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        }
        // End of quoted field
        inQuotes = false;
        i++;
        continue;
      }
      currentField += char;
      i++;
      continue;
    }

    // Not in quotes
    if (char === '"') {
      inQuotes = true;
      i++;
      continue;
    }

    if (char === ',') {
      currentRow.push(currentField);
      currentField = '';
      i++;
      continue;
    }

    if (char === '\r') {
      // Handle CRLF — skip the \r, let \n handle the line break
      i++;
      continue;
    }

    if (char === '\n') {
      currentRow.push(currentField);
      currentField = '';
      rows.push(currentRow);
      currentRow = [];
      i++;
      continue;
    }

    currentField += char;
    i++;
  }

  // Handle last field/row if input doesn't end with newline
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}

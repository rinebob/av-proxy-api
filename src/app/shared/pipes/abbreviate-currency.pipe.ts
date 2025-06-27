import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'abbreviateCurrency',
  standalone: true
})
export class AbbreviateCurrencyPipe implements PipeTransform {
  transform(value: number | string, digitsInfo: string | number = '1.0-0'): string {
    if (value === null || value === undefined || value === '') return '$0';

    const num = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(num)) return '$0';

    // Backward compatible: parse digitsInfo for decimals
    let decimals = 1;
    if (typeof digitsInfo === 'number') {
      decimals = digitsInfo;
    } else if (typeof digitsInfo === 'string') {
      // Match Angular number pipe style: '1.2-2' => decimals = 2
      const match = digitsInfo.match(/\d+\.(\d+)-(\d+)/);
      if (match) {
        decimals = parseInt(match[2], 10);
      }
    }

    // Format with M/B suffixes
    if (Math.abs(num) >= 1000000000) {
      return `$${(num / 1000000000).toFixed(2)}B`;  // Always show 2 decimals for billions
    } else if (Math.abs(num) >= 1000000) {
      return `$${(num / 1000000).toFixed(decimals)}M`;
    } else if (Math.abs(num) >= 1000) {
      return `$${(num / 1000).toFixed(decimals)}K`;
    }

    // For numbers less than 1000, just format as currency with no decimals
    return `$${num.toFixed(0)}`;
  }
}


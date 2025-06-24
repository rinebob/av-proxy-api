import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'abbreviateCurrency',
  standalone: true
})
export class AbbreviateCurrencyPipe implements PipeTransform {
  transform(value: number | string, digits: number = 1): string {
    if (value === null || value === undefined || value === '') return '$0';
    
    const num = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(num)) return '$0';
    
    // Format with M/B suffixes
    if (Math.abs(num) >= 1000000000) {
      return `$${(num / 1000000000).toFixed(2)}B`;  // Always show 2 decimals for billions
    } else if (Math.abs(num) >= 1000000) {
      return `$${(num / 1000000).toFixed(digits)}M`;
    } else if (Math.abs(num) >= 1000) {
      return `$${(num / 1000).toFixed(digits)}K`;
    }
    
    // For numbers less than 1000, just format as currency with no decimals
    return `$${num.toFixed(0)}`;
  }
}

/**
 * Safely formats a date value, handling various input types
 * @param value The date value to format (Date, string, number, or Firestore Timestamp)
 * @param format The date format style ('short', 'medium', 'long', 'full')
 * @param fallback The fallback text to display if date is invalid (defaults to 'N/A')
 * @returns Formatted date string or fallback
 */
export function safeDate(
  value: any, 
  format: 'short' | 'medium' | 'long' | 'full' = 'medium', 
  fallback: string = 'N/A'
): string {
  if (!value) return fallback;
  
  try {
    let date: Date | null = null;
    
    // Handle Firestore Timestamp
    if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
      date = value.toDate();
    } 
    // Handle { seconds, nanoseconds } format
    else if (value && typeof value === 'object' && 'seconds' in value) {
      date = new Date(value.seconds * 1000 + (value.nanoseconds || 0) / 1000000);
    }
    // Handle string dates
    else if (typeof value === 'string') {
      date = new Date(value);
    }
    // Handle timestamps (seconds or milliseconds)
    else if (typeof value === 'number') {
      date = new Date(value > 1e10 ? value : value * 1000);
    }
    // Already a Date object
    else if (value instanceof Date) {
      date = value;
    }
    
    // If we have a valid date, format it
    if (date && !isNaN(date.getTime())) {
      return new Intl.DateTimeFormat('en-US', { 
        dateStyle: format,
        timeStyle: format
      }).format(date);
    }
    
    return fallback;
  } catch (error) {
    console.warn('Error formatting date:', { value, error });
    return fallback;
  }
}

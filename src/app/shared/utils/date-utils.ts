/**
 * Safely formats a date value, handling various input types.
 * 
 * This function is used by {@link processTimestamps} to handle individual date conversions.
 * For processing entire objects or arrays, use {@link processTimestamps} instead.
 * 
 * @param value The date value to format (Date, string, number, or Firestore Timestamp)
 * @param format The date format style ('short', 'medium', 'long', 'full')
 * @param fallback The fallback text to display if date is invalid (defaults to 'N/A')
 * @returns Formatted date string or fallback
 * 
 * @see processTimestamps For processing entire objects or arrays containing dates
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

/**
 * Recursively processes an object to convert Firestore Timestamps to Date objects.
 * Handles all possible Firestore timestamp formats including nested objects and arrays.
 * 
 * This function uses {@link safeDate} internally for the actual date conversion.
 * 
 * @template T The type of the input object
 * @param obj The object to process (can be any type including primitives, arrays, or objects)
 * @returns A new object with all timestamps converted to Date objects
 * 
 * @see safeDate For formatting individual date values as strings
 */
export function processTimestamps<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Process arrays
  if (Array.isArray(obj)) {
    return obj.map(item => processTimestamps(item)) as unknown as T;
  }

  // Process plain objects (including nested ones)
  if (typeof obj === 'object' && obj !== null) {
    const result: Record<string, any> = {};
    
    // Known date fields that should always be processed
    const dateFields = [
      'createdAt', 'updatedAt', 'lastRefreshed', 
      'lastSeen', 'firstSeen', 'deactivatedAt',
      'date', 'timestamp', 'time', 'modifiedAt'
    ];
    
    // Special handling for Firestore document metadata
    const isFirestoreDoc = '_document' in obj || '_firestore' in obj;
    
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const value = (obj as any)[key];
        
        // Always process known date fields
        if (dateFields.includes(key) || key.endsWith('At') || key.endsWith('Date')) {
          result[key] = safeDate(value, 'medium', value);
        } 
        // For Firestore documents, process all fields
        else if (isFirestoreDoc) {
          result[key] = processTimestamps(value);
        }
        // For other objects, only process if it's not a plain object (to avoid excessive processing)
        else if (value && typeof value === 'object' && !Array.isArray(value)) {
          // Only process if it looks like a date object
          if ('seconds' in value && 'nanoseconds' in value) {
            // Convert to Date object first, then format if needed
            result[key] = safeDate(value, 'medium', value);
          } else {
            result[key] = processTimestamps(value);
          }
        } else {
          result[key] = value;
        }
      }
    }
    
    // Preserve special properties like __proto__
    if (Object.getPrototypeOf(obj) !== Object.prototype) {
      Object.setPrototypeOf(result, Object.getPrototypeOf(obj));
    }
    
    return result as T;
  }

  return obj;
}

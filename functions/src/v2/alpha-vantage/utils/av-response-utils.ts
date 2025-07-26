/**
 * Throws a descriptive error if the Alpha Vantage API response contains an error, information, or note.
 * Call this at the start of every transformResponse.
 */
export function validateAlphaVantageApiResponse(data: any): void {
  if (data["Information"]) {
    // "Information" is usually a rate limit or general info error
    throw new Error(`[AlphaVantage Information] ${data["Information"]}`);
  }
  if (data["Note"]) {
    // "Note" is usually a rate limit warning or similar
    throw new Error(`[AlphaVantage Note] ${data["Note"]}`);
  }
  if (data["Error Message"]) {
    // "Error Message" is a hard error from the API
    throw new Error(`[AlphaVantage Error Message] ${data["Error Message"]}`);
  }
}

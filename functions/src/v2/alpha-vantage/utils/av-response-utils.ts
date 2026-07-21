export enum AlphaVantageProviderResponseErrorKind {
  INFORMATION = 'INFORMATION',
  NOTE = 'NOTE',
  ERROR_MESSAGE = 'ERROR_MESSAGE',
}

export class AlphaVantageProviderResponseError extends Error {
  public constructor(
    public readonly kind: AlphaVantageProviderResponseErrorKind,
    public readonly providerMessage: string,
  ) {
    super(providerMessage);
    this.name = 'AlphaVantageProviderResponseError';
  }
}

export function validateAlphaVantageApiResponse(data: object): void {
  const response = data as Record<string, unknown>;

  if (typeof response.Information === 'string' && response.Information) {
    throw new AlphaVantageProviderResponseError(AlphaVantageProviderResponseErrorKind.INFORMATION, response.Information);
  }

  if (typeof response.Note === 'string' && response.Note) {
    throw new AlphaVantageProviderResponseError(AlphaVantageProviderResponseErrorKind.NOTE, response.Note);
  }

  if (typeof response['Error Message'] === 'string' && response['Error Message']) {
    throw new AlphaVantageProviderResponseError(AlphaVantageProviderResponseErrorKind.ERROR_MESSAGE, response['Error Message']);
  }
}

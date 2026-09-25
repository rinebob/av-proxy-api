import { HttpsError } from 'firebase-functions/v2/https';

import { SetOptionsEnabledErrorCode, type SetOptionsEnabledResult } from '@shared/alpha-vantage';

export function toSetOptionsEnabledHttpsError(result: SetOptionsEnabledResult): HttpsError {
  const code = result.errorCode === SetOptionsEnabledErrorCode.OPTIONS_NOT_OPTIONABLE
    ? 'failed-precondition'
    : result.errorCode === SetOptionsEnabledErrorCode.SYMBOL_NOT_FOUND
      ? 'not-found'
      : result.errorCode === SetOptionsEnabledErrorCode.UNAUTHENTICATED
        ? 'unauthenticated'
        : result.errorCode === SetOptionsEnabledErrorCode.INVALID_ARGUMENT
          ? 'invalid-argument'
          : 'internal';
  return new HttpsError(code, result.error ?? 'Unable to update optionsEnabled.', {
    errorCode: result.errorCode,
    symbol: result.symbol,
  });
}

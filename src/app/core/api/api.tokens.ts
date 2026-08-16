import { InjectionToken } from '@angular/core';

/**
 * @topic #17 — SA UI — AV Hilbert Transform Endpoint Integration (opened 2026-08-15)
 */
export type ApiBases = {
  health: string;
  av: string;
  dm: string;
  benzinga: string;
  partner: string;
};

export const API_BASES = new InjectionToken<ApiBases>('API_BASES');

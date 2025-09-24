import { InjectionToken } from '@angular/core';

export type ApiBases = {
  health: string;
  av: string;
  dm: string;
  benzinga: string;
};

export const API_BASES = new InjectionToken<ApiBases>('API_BASES');

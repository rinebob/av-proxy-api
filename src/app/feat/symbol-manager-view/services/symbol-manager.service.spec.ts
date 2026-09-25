import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Functions } from '@angular/fire/functions';

import { SymbolManagerService } from './symbol-manager.service';
import { API_BASES } from '../../../core/api/api.tokens';
import { SetOptionsEnabledErrorCode, SetOptionsEnabledResult } from '@shared/alpha-vantage';

describe('SymbolManagerService — setOptionsEnabled (Task #144)', () => {
  let service: SymbolManagerService;
  let callable: jasmine.Spy;

  const bases = { health: '', av: '', dm: 'http://test', benzinga: '', partner: '' };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Functions, useValue: {} },
        { provide: API_BASES, useValue: bases },
      ],
    });
    service = TestBed.inject(SymbolManagerService);
    // The callable handle is created at construction; swap it for a spy.
    callable = jasmine.createSpy('setOptionsEnabledFn');
    (service as any).setOptionsEnabledFn = callable;
  });

  it('sends {symbol, enabled, reason} and maps the result', async () => {
    const result: SetOptionsEnabledResult = { ok: true, symbol: 'AAPL', transitioned: true, optionsEnabled: true };
    callable.and.returnValue(Promise.resolve({ data: result }));

    const r = await new Promise<SetOptionsEnabledResult>((res, rej) =>
      service.setOptionsEnabled('aapl', true, 'pilot').subscribe({ next: res, error: rej }),
    );

    expect(callable).toHaveBeenCalledWith({ symbol: 'AAPL', enabled: true, reason: 'pilot' });
    expect(r).toEqual(result);
  });

  it('omits reason when not provided', async () => {
    callable.and.returnValue(Promise.resolve({ data: { ok: true, symbol: 'AAPL', transitioned: false } }));
    await new Promise((res) => service.setOptionsEnabled('AAPL', true).subscribe({ next: res }));
    expect(callable).toHaveBeenCalledWith({ symbol: 'AAPL', enabled: true });
  });

  it('maps HttpsError details to an ok:false result (OPTIONS_NOT_OPTIONABLE)', async () => {
    callable.and.returnValue(Promise.reject({
      code: 'functions/failed-precondition',
      message: 'Symbol BRK-B is not optionable',
      details: { errorCode: SetOptionsEnabledErrorCode.OPTIONS_NOT_OPTIONABLE, symbol: 'BRK-B' },
    }));

    const r = await new Promise<SetOptionsEnabledResult>((res, rej) =>
      service.setOptionsEnabled('BRK-B', true).subscribe({ next: res, error: rej }),
    );

    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe(SetOptionsEnabledErrorCode.OPTIONS_NOT_OPTIONABLE);
    expect(r.transitioned).toBe(false);
  });
});

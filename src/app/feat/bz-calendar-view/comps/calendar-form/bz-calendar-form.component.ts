import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatNativeDateModule } from '@angular/material/core';
import { MatIconModule } from '@angular/material/icon';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { BenzingaCalendarParameter, BzCalendarRequestType, BZ_CALENDAR_PARAMETER_DEFS, BZ_CALENDAR_REQUEST_CONFIGS } from '@shared/benzinga';
import { BzCalendarViewBaseComponent } from '../../bz-calendar-view-base.component';
import { DatepickerRefDirective } from '../../../../shared/directives/datepicker-ref.directive';

@Component({
  selector: 'bz-calendar-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatNativeDateModule,
    MatIconModule,
    DatepickerRefDirective
  ],
  templateUrl: './bz-calendar-form.component.html',
  styleUrls: ['./bz-calendar-form.component.scss']
})
export class BzCalendarFormComponent extends BzCalendarViewBaseComponent implements OnInit {
  public readonly BenzingaEndpoint = BzCalendarRequestType;
  public readonly BenzingaCalendarParameter = BenzingaCalendarParameter;
  public readonly BZ_CALENDAR_PARAMETER_DEFS = BZ_CALENDAR_PARAMETER_DEFS;
  
  searchForm: FormGroup;
  includeTicker = signal(false);

  // Get all visible parameters for the current endpoint - directly from store meta
  readonly visibleParams = computed(() => {
    const endpointMeta = this.bzCalendarStore.selectedEndpointMeta();
    if (!endpointMeta?.config?.parameterKeys) return [];
    
    // Get the endpoint's parameter keys
    const endpointParams = endpointMeta.config.parameterKeys;
    
    console.log('bCF vP Raw endpoint parameters:', endpointParams);
    
    // Filter out internal parameters that shouldn't be shown in the UI
    const internalParams = [
      BenzingaCalendarParameter.PAGE,
      BenzingaCalendarParameter.PAGESIZE,
      BenzingaCalendarParameter.DATE, // We'll use DATE_FROM and DATE_TO instead
      BenzingaCalendarParameter.UPDATED, // Internal timestamp
    ];
    
    // First, filter out internal params and get unique parameters
    const filteredParams = endpointParams.filter(
      param => !internalParams.includes(param as BenzingaCalendarParameter)
    );
    
    // Get unique parameters while preserving order
    const uniqueParams = [...new Set(filteredParams)];
    
    // Define possible dropdown parameters
    const possibleDropdownParams = [
      BenzingaCalendarParameter.DATE_SORT,
      BenzingaCalendarParameter.IMPORTANCE,
      BenzingaCalendarParameter.DIVIDEND_YIELD_OPERATION,
      BenzingaCalendarParameter.ACTION
    ];
    
    // Only include dropdown params that are actually in the endpoint's parameters
    const relevantDropdownParams = possibleDropdownParams.filter(
      param => uniqueParams.includes(param)
    );
    
    // Combine and deduplicate
    const finalParams = [...new Set([...relevantDropdownParams, ...uniqueParams])];
    
    console.log('bCF vP Final parameters:', finalParams);
    return finalParams;
  });

  // Computed signal for parameter definitions
  paramDefs = computed(() => {
    const defs: Record<string, any> = {};
    Object.entries(BZ_CALENDAR_PARAMETER_DEFS).forEach(([key, value]) => {
      defs[key] = value;
    });
    console.log('bCF paramDefs:', defs);
    return defs;
  });

  // Parameters that should be shown in the first row
  firstRowParams = computed(() => {
    const firstRowParamSet = new Set([
      BenzingaCalendarParameter.DATE_FROM,
      BenzingaCalendarParameter.DATE_TO,
      BenzingaCalendarParameter.TICKERS
    ]);
    
    return this.visibleParams().filter(param => 
      firstRowParamSet.has(param as BenzingaCalendarParameter)
    );
  });

  // Parameters that should be shown in the second row
  secondRowParams = computed(() => {
    const firstRowParamSet = new Set([
      BenzingaCalendarParameter.DATE_FROM,
      BenzingaCalendarParameter.DATE_TO,
      BenzingaCalendarParameter.TICKERS
    ]);
    
    return this.visibleParams().filter(param => 
      !firstRowParamSet.has(param as BenzingaCalendarParameter)
    );
  });

  // Track datepicker references using a signal
  datepickerRefs = signal<{ [key: string]: any }>({});

  // Generate a unique ID for each datepicker
  getDatepickerId(param: string): string {
    return `datepicker-${param}`;
  }

  constructor(private fb: FormBuilder) {
    super();
    this.searchForm = this.createForm();
  }

  ngOnInit() {
    // Subscribe to endpoint changes to update form fields
    this.bzCalendarStore.selectedEndpoint$
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe(() => {
        this.updateFormForRequest();
      });
  }

  private createForm(): FormGroup {
    const formGroup: Record<string, any> = {};
    
    // Get all possible parameters from the config
    Object.keys(BenzingaCalendarParameter).forEach(key => {
      const paramKey = BenzingaCalendarParameter[key as keyof typeof BenzingaCalendarParameter];
      const def = BZ_CALENDAR_PARAMETER_DEFS[paramKey];
      
      if (def) {
        // Use the default value from the parameter definition if available
        const defaultValue = def.default !== undefined ? def.default : 
                           def.type === 'boolean' ? false :
                           def.type === 'number' ? 0 : '';
        
        // Create validators
        const validators = [];
        if (def.required) {
          validators.push(Validators.required);
        }
        if (def.pattern) {
          validators.push(Validators.pattern(def.pattern));
        }
        if (def.type === 'number') {
          validators.push(Validators.min(def.min || 0));
          if (def.max !== undefined) {
            validators.push(Validators.max(def.max));
          }
        }
        
        formGroup[paramKey] = [defaultValue, validators];
      }
    });
    
    return this.fb.group(formGroup);
  }

  private updateFormForRequest() {

    const requestConfig = this.bzCalendarStore.selectedEndpointMeta();
    if (!requestConfig?.config.parameterKeys) return;

    // Disable all controls first
    Object.keys(this.searchForm.controls).forEach(key => {
      this.searchForm.get(key)?.disable({ emitEvent: false });
    });

    // Enable only the controls that are relevant to this endpoint
    requestConfig.config.parameterKeys.forEach(param => {
      const control = this.searchForm.get(param);
      if (control) {
        control.enable({ emitEvent: false });
      }
    });
    
    // Reset ticker toggle state
    this.includeTicker.set(false);
  }

  onSubmit() {
    if (this.searchForm.invalid) {
      this.searchForm.markAllAsTouched();
      return;
    }

    const formValue = { ...this.searchForm.value };
    const currentRequest = this.bzCalendarStore.selectedEndpoint();
    const requestConfig = this.bzCalendarStore.selectedEndpointMeta().config;
    
    if (!requestConfig?.parameterKeys) {
      console.error('No configuration found for request:', currentRequest);
      return;
    }

    // Build params object with only the allowed parameters for this endpoint
    const params: Record<string, any> = {
      type: currentRequest,
      page: 0 // Always start at page 0
    };

    // Add form values for all parameters in the config
    requestConfig.parameterKeys.forEach(param => {
      const value = formValue[param];
      
      // Skip null/undefined/empty values
      if (value === null || value === undefined || value === '') {
        return;
      }
      
      // Format dates as YYYY-MM-DD
      if (value instanceof Date) {
        params[param] = value.toISOString().split('T')[0];
      } 
      // Handle ticker toggle
      else if (param === BenzingaCalendarParameter.TICKERS && !this.includeTicker()) {
        return; // Skip ticker if toggle is off
      }
      // Handle regular parameters
      else {
        params[param] = value;
      }
    });

    console.log('Submitting calendar search with params:', params);
    this.bzCalendarStore.searchCalendar(params as any);
  }
  
  // Get options for select fields
  getEnumOptions(param: string | BenzingaCalendarParameter): { value: any; label: string }[] {
    const paramKey = param as BenzingaCalendarParameter;
    const paramDef = BZ_CALENDAR_PARAMETER_DEFS[paramKey];
    if (!paramDef?.enum) return [];
    
    // Special handling for DATE_SORT parameter
    if (param === BenzingaCalendarParameter.DATE_SORT) {
      return [
        { value: 'date:asc', label: 'Ascending' },
        { value: 'date:desc', label: 'Descending' }
      ];
    }
    
    return paramDef.enum.map((value: string) => ({
      value,
      label: value.toString().charAt(0).toUpperCase() + value.toString().slice(1).replace(/_/g, ' ')
    }));
  }
}

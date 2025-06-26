import { signalStore, withState } from '@ngrx/signals';

/**
 * State for Benzinga calendar UI.
 * - selectedEndpoint: string
 * - formValues: Record<string, any>
 * - responseData: any
 * - loading: boolean
 * - error: string | null
 */
export interface BenzingaCalendarState {
  selectedEndpoint: string | null;
  formValues: Record<string, any>;
  responseData: any;
  loading: boolean;
  error: string | null;
}

const initialState: BenzingaCalendarState = {
  selectedEndpoint: null,
  formValues: {},
  responseData: null,
  loading: false,
  error: null
};

export const BenzingaCalendarStore = signalStore(
  { providedIn: 'root' },
  withState(initialState)
);

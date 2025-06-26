import { signalStore, withState, withMethods, patchState } from '@ngrx/signals';
import { BenzingaEndpoint } from '../../../common/common-bz';

/**
 * State for Benzinga calendar UI.
 * - selectedEndpoint: BenzingaEndpoint | null
 * - formValues: Record<string, any>
 * - responseData: any
 * - loading: boolean
 * - error: string | null
 */
export interface BenzingaCalendarState {
  selectedEndpoint: BenzingaEndpoint | null;
  formValues: Record<string, any>;
  responseData: any;
  loading: boolean;
  error: string | null;
}

const initialState: BenzingaCalendarState = {
  selectedEndpoint: BenzingaEndpoint.EARNINGS,
  formValues: {},
  responseData: null,
  loading: false,
  error: null
};

/**
 * NgRx Signal Store for Benzinga Calendar feature.
 * Provides signal getter and updater for selectedEndpoint.
 */
export const BenzingaCalendarStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withMethods((store) => ({
    /** Signal getter for the selected endpoint */
    get selectedEndpoint() {
      return store.selectedEndpoint;
    },
    /** Updater for the selected endpoint */
    setSelectedEndpoint(endpoint: BenzingaEndpoint) {
      patchState(store, { selectedEndpoint: endpoint });
    }
  }))
);


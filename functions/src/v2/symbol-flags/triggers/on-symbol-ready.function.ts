/**
 * onSymbolReady — fires the one-shot optionable probe when a tracked symbol
 * finishes onboarding (Thread #105 §79).
 *
 * Watches tracked-symbols updates and probes when `_onboardingStatus`
 * transitions to READY while `optionable` is still absent. All logic lives
 * in symbol-ready.core.ts (side-effect-free for tests); this file only
 * wires prod deps. The core never throws — no Firestore retry flap.
 */
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';

import { db } from '../../../firebase-admin-init';
import { FirestoreCollection } from '@shared/firestore';
import { createHistoricalOptionsRetrievalService } from '../../historical-options-corpus/services/historical-options-retrieval.service';
import { OptionableProbeService } from '../services/optionable-probe.service';
import { handleSymbolReadyTransition } from './symbol-ready.core';

export const onSymbolReady = onDocumentUpdated(
  {
    document: `${FirestoreCollection.TRACKED_SYMBOLS}/{symbol}`,
    // The probe calls Alpha Vantage — without this the key is never injected
    // and every invocation ends 'probe-failed'.
    secrets: ['ALPHAVANTAGE_API_KEY'],
  },
  async (event) => {
    const probe = new OptionableProbeService({
      retrieval: createHistoricalOptionsRetrievalService(),
      db,
      logger: console,
    });
    const outcome = await handleSymbolReadyTransition(
      event.params.symbol,
      event.data?.before.data(),
      event.data?.after.data(),
      { probeAndPersist: (symbol) => probe.probeAndPersist(symbol), logger: console },
    );
    console.info(`onSymbolReady ${event.params.symbol}: ${outcome}`);
  },
);

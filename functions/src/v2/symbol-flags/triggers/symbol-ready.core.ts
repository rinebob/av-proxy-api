/**
 * Core of the on-add optionable probe trigger (Thread #105 §79/§88).
 *
 * Fires on tracked-symbols doc updates: when `_onboardingStatus` transitions
 * to READY and `optionable` is still absent, run the probe once. This single
 * seam covers every READY path (direct equity+overview-ok, non-equity, and
 * the overview-retry task).
 *
 * Never throws — a Firestore trigger retry would flap on every subsequent
 * doc update. Non-quota probe failures are persisted by the service itself
 * (optionable=false + optionableProbeError); quota errors rethrow from the
 * service and are caught here, leaving the flag absent for a later retry or
 * the manual backfill.
 */
import { TRACKED_SYMBOL_V2_FIELDS as F, TrackedSymbolOnboardingStatus } from '@shared/alpha-vantage';

export type ReadyTransitionOutcome =
  | 'probed'
  | 'probe-failed'
  | 'skipped-no-transition'
  | 'skipped-already-probed';

export interface ReadyTransitionDeps {
  /** OptionableProbeService.probeAndPersist. */
  probeAndPersist(symbol: string): Promise<unknown>;
  logger?: { info(m: string): void; warn(m: string): void };
}

export async function handleSymbolReadyTransition(
  docId: string,
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
  deps: ReadyTransitionDeps,
): Promise<ReadyTransitionOutcome> {
  const becameReady =
    after?.[F.ONBOARDING_STATUS] === TrackedSymbolOnboardingStatus.READY &&
    before?.[F.ONBOARDING_STATUS] !== TrackedSymbolOnboardingStatus.READY;
  if (!becameReady) return 'skipped-no-transition';

  if (after?.[F.OPTIONABLE] !== undefined && after?.[F.OPTIONABLE] !== null) {
    return 'skipped-already-probed';
  }

  // Doc id is authoritative — it's the tracked-symbols key; a disagreeing
  // `symbol` field in the doc would probe/persist the wrong doc.
  const symbol = docId.trim().toUpperCase();
  if (!symbol) return 'skipped-no-transition';
  try {
    await deps.probeAndPersist(symbol);
    deps.logger?.info(`on-symbol-ready: probed ${symbol} on →READY`);
    return 'probed';
  } catch (e) {
    deps.logger?.warn(
      `on-symbol-ready: probe failed for ${symbol} — ${e instanceof Error ? e.message : String(e)} (not retrying)`,
    );
    return 'probe-failed';
  }
}

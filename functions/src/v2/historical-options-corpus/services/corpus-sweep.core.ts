/**
 * runCorpusSweep — scheduled corpus reconcile (Task #154).
 *
 * Enumerates the live options-enabled set and reconciles each symbol via the
 * pivot-seed fanout: seeds gaps between the swing doc's planned dates and GCS
 * coverage, and deletes superseded interim snapshots. Per-symbol failures are
 * caught and reported — one bad symbol never aborts the sweep.
 *
 * Side-effect-free: deps are injected (like swing-set-sweep.core).
 */
export interface CorpusSweepResult {
  /** options-enabled symbols examined. */
  checked: string[];
  /** Total seed tasks dispatched across all symbols. */
  seeded: number;
  /** Total superseded interim snapshots deleted. */
  deletedInterims: number;
  /** Per-symbol failures — sweep continues past these. */
  failed: { symbol: string; error: string }[];
}

export interface CorpusSweepDeps {
  /** Live curation set (options-enabled-gate). */
  listOptionsEnabledSymbols: () => Promise<string[]>;
  /** fanoutPivotSeeds bound to its deps — the per-symbol reconcile. */
  reconcile: (symbol: string) => Promise<{ enqueued: number; deleted: number }>;
  logger: { info(m: string): void; warn(m: string): void };
}

export async function runCorpusSweep(deps: CorpusSweepDeps): Promise<CorpusSweepResult> {
  const result: CorpusSweepResult = { checked: [], seeded: 0, deletedInterims: 0, failed: [] };

  const symbols = (await deps.listOptionsEnabledSymbols()).map((s) => s.trim().toUpperCase()).filter(Boolean);
  deps.logger.info(`corpus sweep: ${symbols.length} options-enabled symbol(s) to reconcile`);

  for (const symbol of symbols) {
    try {
      const r = await deps.reconcile(symbol);
      result.checked.push(symbol);
      result.seeded += r.enqueued;
      result.deletedInterims += r.deleted;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      deps.logger.warn(`corpus sweep: ${symbol} failed — ${error}`);
      result.failed.push({ symbol, error });
    }
  }

  deps.logger.info(
    `corpus sweep done — checked=${result.checked.length} seeded=${result.seeded} ` +
      `deletedInterims=${result.deletedInterims} failed=${result.failed.length}`,
  );
  return result;
}

/**
 * Display formatters for the Symbol Manager V2 companyInfo columns.
 * All render an em-dash for absent/invalid values. Pure — no Angular deps.
 */

export function orDash(value: string | null | undefined): string {
  return value ? value : '—';
}

export function formatMarketCap(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return '—';
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  return `$${value.toFixed(0)}`;
}

export function formatBeta(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(2);
}

import { AvCompanyOverview, TrackedSymbolCompanyInfo } from '@shared/alpha-vantage';

/** String-valued companyInfo keys copied verbatim (marketCap/beta are numeric and handled separately). */
type CompanyInfoStringField = Exclude<keyof TrackedSymbolCompanyInfo, 'marketCap' | 'beta'>;

/** Fields copied verbatim from AvCompanyOverview into the tracked-symbols doc for sorting/filtering. */
const COMPANY_INFO_FIELDS: ReadonlyArray<CompanyInfoStringField> = [
  'Symbol', 'AssetType', 'Name', 'Description', 'CIK',
  'Exchange', 'Currency', 'Country', 'Sector', 'Industry',
  'Address', 'OfficialSite', 'FiscalYearEnd',
];

/** Parses an AV string field into a finite number; undefined when absent/empty/non-numeric. */
function parseAvNumeric(value: string | null | undefined): number | undefined {
  const str = value?.trim();
  if (!str) return undefined;
  const num = Number(str);
  return Number.isFinite(num) ? num : undefined;
}

/**
 * Builds the denormalized companyInfo subset for the tracked-symbols doc:
 * stable identity fields verbatim plus numeric marketCap/beta parsed from
 * AV's string fields (omitted when absent or non-numeric). Pure — no I/O.
 */
export function buildTrackedSymbolCompanyInfo(
  data: Partial<AvCompanyOverview>
): Partial<TrackedSymbolCompanyInfo> {
  const companyInfo = COMPANY_INFO_FIELDS.reduce((acc, key) => {
    const val = data[key];
    if (val !== undefined) acc[key] = val;
    return acc;
  }, {} as Partial<TrackedSymbolCompanyInfo>);

  const marketCap = parseAvNumeric(data.MarketCapitalization);
  if (marketCap !== undefined) companyInfo.marketCap = marketCap;
  const beta = parseAvNumeric(data.Beta);
  if (beta !== undefined) companyInfo.beta = beta;

  return companyInfo;
}

/**
 * Diffs a freshly-built companyInfo against the stored one and returns the
 * minimal dotted-field-path update payload for Firestore (`companyInfo.X`),
 * or null when nothing changed (idempotent re-runs write nothing).
 * Only emits keys present in `built` — fields stored but absent from `built`
 * are left untouched. Pure — no I/O.
 */
export function diffCompanyInfoForWrite(
  existing: Partial<TrackedSymbolCompanyInfo> | undefined | null,
  built: Partial<TrackedSymbolCompanyInfo>
): Record<string, string | number> | null {
  const delta: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(built)) {
    if (value !== undefined && existing?.[key as keyof TrackedSymbolCompanyInfo] !== value) {
      delta[`companyInfo.${key}`] = value;
    }
  }
  return Object.keys(delta).length > 0 ? delta : null;
}

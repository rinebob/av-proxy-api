// COPIED FROM src/app/feat/bz-calendar-view/common/fe-common-bz-api.ts. Do not use directly until migration is complete.

/**
 * IPOs data structure
 */
export interface IposData {
    id: string,
    date: string,
    time: string,
    ticker: string,
    exchange: string,
    name: string,
    open_date_verified: boolean,
    pricing_date: string,
    currency: string,
    price_min: string,
    price_max: string,
    price_public_offering: string,
    price_open: string,
    deal_status: string,
    ipo_type: string,
    insider_lockup_days: number,
    insider_lockup_date: string,
    offering_value: number,
    offering_shares: number,
    shares_outstanding: number,
    lead_underwriters: string[],
    other_underwriters: string[],
    underwriter_quiet_expiration_days: number,
    underwriter_quiet_expiration_date: string,
    notes: string,
    updated: number
}

export interface IposResponse {
    ipos: IposData[]
}

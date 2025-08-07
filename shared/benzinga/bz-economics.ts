

export interface BzEconomicsData {
    id: string,
    date: string,
    time: string,
    country: string,
    event_name: string,
    event_period: string,
    period_year: number,
    actual: string,
    actual_t: string,
    consensus: string,
    consensus_t: string,
    prior: string,
    prior_t: string,
    importance: number,
    updated: number,
    description: string
}

export interface BzEconomicsResponse {
    economics: BzEconomicsData[]
}

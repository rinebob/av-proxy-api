

export interface BzMergersAcquisitionsData {
    id: string;
    date: string;
    date_expected: string;
    date_completed: string;
    acquirer_ticker: string;
    acquirer_exchange: string;
    acquirer_name: string;
    target_ticker: string;
    target_exchange: string;
    target_name: string;
    currency: string;
    deal_type: string;
    deal_size: string;
    deal_payment_type: string;
    deal_status: string;
    deal_terms_extra: string;
    importance: string;
    notes: string;
    updated: string;
}

export interface BzMergersAcquisitionsDataResponse {
    ma: BzMergersAcquisitionsData[];
}

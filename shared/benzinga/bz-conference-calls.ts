
export interface BzConferenceCallsData {
    id: string;
    date: string;
    time: string;
    name: string;
    exchange: string;
    ticker: string;
    start_time: string;
    phone_num: string;
    international_num: string;
    reservation_num: string;
    access_code: string;
    webcast_url: string;
    importance: number;
    notes: string;
    updated: number;
}
export interface BzConferenceCallsDataResponse {
    conference: BzConferenceCallsData[]
}
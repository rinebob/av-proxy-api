

export interface BzRatingsData {
    id: string;
    date: string;
    time: string;
    ticker: string;
    exchange: string;
    name: string;
    currency: string;
    action_pt: string;
    action_company: string;
    rating_current: string;
    pt_current: string;
    adjusted_pt_current: string;
    rating_prior: string;
    pt_prior: string;
    adjusted_pt_prior: string;
    url: string;
    url_calendar: string;
    url_news: string;
    analyst: string;
    analyst_id: string;
    analyst_name: string;
    ratings_accuracy: BzRatingsAccuracy,
    importance: string,
    notes: string,
    updated: string
  }

  export interface BzRatingsAccuracy {
    smart_score: string;
    overall_success_rate: string;
    overall_avg_return_percentile: string;
    total_ratings_percentile: string;
    total_ratings: string;
    overall_gain_count: string;
    overall_loss_count: string;
    overall_average_return: string;
    overall_stdev: string;
    "1m_gain_count": number;
    "1m_loss_count": number,
    "1m_average_return": number,
    "1m_stdev": number,
    "3m_gain_count": number,
    "3m_loss_count": number,
    "3m_average_return": number,
    "3m_stdev": number,
    "9m_gain_count": number,
    "9m_loss_count": number,
    "9m_average_return": number,
    "9m_stdev": number,
    "1y_gain_count": number,
    "1y_loss_count": number,
    "1y_average_return": number,
    "1y_stdev": number,
    "2y_gain_count": number,
    "2y_loss_count": number,
    "2y_average_return": number,
    "2y_stdev": number,
    "3y_gain_count": number,
    "3y_loss_count": number,
    "3y_average_return": number,
    "3y_stdev": number,
    updated: string
  }

export interface BzRatingsDataResponse {
    ratings: BzRatingsData[];
}
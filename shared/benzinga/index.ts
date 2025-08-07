export * from './bz-calendar-request-configs';
export * from './bz-calendar';
export * from './bz-conference-calls';
export * from './bz-constants';
export * from './bz-dividends';
export * from './bz-earnings';
export * from './bz-economics';
export * from './bz-endpoints';
export * from './bz-guidance';
export * from './bz-news-channels';
export * from './bz-mergers-acquisitions';
export * from './bz-news-request-configs';
export * from './bz-ipos';
export * from './bz-news';
export * from './bz-ratings';
export * from './bz-splits';
export * from './bz-types';

// Default export: aggregate all named exports into a single object
import * as calendarRequestConfigs from './bz-calendar-request-configs';
import * as conferenceCalls from './bz-conference-calls';
import * as constants from './bz-constants';
import * as endpoints from './bz-endpoints';
import * as newsChannels from './bz-news-channels';
import * as newsRequestConfigs from './bz-news-request-configs';
import * as calendar from './bz-calendar';
import * as dividends from './bz-dividends';
import * as earnings from './bz-earnings';
import * as economics from './bz-economics';
import * as guidance from './bz-guidance';
import * as ipos from './bz-ipos';
import * as mergersAcquisitions from './bz-mergers-acquisitions';
import * as news from './bz-news';
import * as ratings from './bz-ratings';
import * as splits from './bz-splits';
import * as types from './bz-types'

const benzinga = {
  ...calendarRequestConfigs,
  ...conferenceCalls,
  ...calendar,
  ...constants,
  ...dividends,
  ...earnings,
  ...economics,
  ...endpoints,
  ...guidance,
  ...ipos,
  ...mergersAcquisitions,
  ...news,
  ...newsChannels,
  ...newsRequestConfigs,
  ...ratings,
  ...splits,
  ...types,
};

export default benzinga;
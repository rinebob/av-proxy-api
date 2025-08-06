export * from './bz-calendar-request-configs';
export * from './bz-constants';
export * from './bz-endpoints';
export * from './bz-news-channels';
export * from './bz-news-request-configs';
export * from './bz-types';
export * from './calendar';
export * from './dividends';
export * from './earnings';
export * from './ipos';
export * from './news';
export * from './splits';

// Default export: aggregate all named exports into a single object
import * as bzCalendarRequestConfigs from './bz-calendar-request-configs';
import * as bzConstants from './bz-constants';
import * as bzEndpoints from './bz-endpoints';
import * as bzNewsChannels from './bz-news-channels';
import * as bzNewsRequestConfigs from './bz-news-request-configs';
import * as bzTypes from './bz-types';
import * as calendar from './calendar';
import * as dividends from './dividends';
import * as earnings from './earnings';
import * as ipos from './ipos';
import * as news from './news';
import * as splits from './splits';

const benzinga = {
  ...bzCalendarRequestConfigs,
  ...bzConstants,
  ...bzEndpoints,
  ...bzNewsChannels,
  ...bzNewsRequestConfigs,
  ...bzTypes,
  ...calendar,
  ...dividends,
  ...earnings,
  ...ipos,
  ...news,
  ...splits,
};

export default benzinga;
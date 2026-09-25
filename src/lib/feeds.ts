export type FeedType = "shows" | "premieres" | "movies";

export interface FeedDefinition {
  type: FeedType;
  title: string;
  description: string;
  calendarName: string;
  // Movies only have a release date, so they're always all-day events.
  supportsTimedEvents: boolean;
}

export const FEEDS: FeedDefinition[] = [
  {
    type: "shows",
    title: "TV Episodes",
    description: "Every episode airing for shows on your watchlist and in progress.",
    calendarName: "Trakt TV Episodes",
    supportsTimedEvents: true,
  },
  {
    type: "premieres",
    title: "TV Season Premieres",
    description: "Only the first episode of each season, including series premieres.",
    calendarName: "Trakt TV Premieres",
    supportsTimedEvents: true,
  },
  {
    type: "movies",
    title: "Movie Releases",
    description: "Release dates for movies on your watchlist.",
    calendarName: "Trakt Movie Releases",
    supportsTimedEvents: false,
  },
];

export const COMBINED_CALENDAR_NAME = "Trakt Watchlist Calendar";

export function getFeed(type: string | undefined): FeedDefinition | undefined {
  return FEEDS.find((f) => f.type === type);
}

// Defaults and caps for the ?past= / ?future= day ranges. Trakt serves at most
// 33 days per calendar request, so 365 + 365 days is 23 requests per feed type.
// The legacy combined feed (no ?type=) fetches two types, which is 46 requests,
// still under the Workers free-plan limit of 50 subrequests per invocation.
export const DEFAULT_PAST_DAYS = 30;
export const DEFAULT_FUTURE_DAYS = 90;
export const MAX_PAST_DAYS = 365;
export const MAX_FUTURE_DAYS = 365;

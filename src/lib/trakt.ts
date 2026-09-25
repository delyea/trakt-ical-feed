import type {
  TraktTokenResponse,
  TraktUser,
  CalendarShow,
  CalendarMovie,
  WatchlistMovie,
  WatchlistShow,
  TraktHistoryEntry,
  TraktMovieRating,
} from "./types";

const TRAKT_API = "https://api.trakt.tv";
const USER_AGENT = "trakt-serverless-ical/1.0.0";

function headers(clientId: string, accessToken?: string): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    "trakt-api-key": clientId,
    "trakt-api-version": "2",
  };
  if (accessToken) {
    h["Authorization"] = `Bearer ${accessToken}`;
  }
  return h;
}

export async function exchangeCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<TraktTokenResponse> {
  const res = await fetch(`${TRAKT_API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  console.log(redirectUri)
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status}\n${await res.text()}`);
  }

  return res.json();
}

export async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<TraktTokenResponse> {
  const res = await fetch(`${TRAKT_API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status}`);
  }

  return res.json();
}

export async function getProfile(
  clientId: string,
  accessToken: string
): Promise<TraktUser> {
  const res = await fetch(`${TRAKT_API}/users/me`, {
    headers: headers(clientId, accessToken),
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch profile: ${res.status}`);
  }

  return res.json();
}

// Trakt caps a single calendar request at 33 days, so longer ranges are split
// into consecutive chunks and fetched in parallel.
const CALENDAR_CHUNK_DAYS = 33;

async function fetchCalendarRange<T>(
  kind: "shows" | "shows/premieres" | "movies",
  clientId: string,
  accessToken: string,
  pastDays: number,
  futureDays: number
): Promise<T[]> {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - pastDays);
  const totalDays = pastDays + futureDays;

  const requests: Promise<T[]>[] = [];
  for (let offset = 0; offset < totalDays; offset += CALENDAR_CHUNK_DAYS) {
    const chunkStart = new Date(start);
    chunkStart.setUTCDate(chunkStart.getUTCDate() + offset);
    const date = chunkStart.toISOString().split("T")[0];
    const days = Math.min(CALENDAR_CHUNK_DAYS, totalDays - offset);

    requests.push(
      fetch(`${TRAKT_API}/calendars/my/${kind}/${date}/${days}`, {
        headers: headers(clientId, accessToken),
      }).then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to fetch calendar ${kind}: ${res.status}`);
        }
        return res.json() as Promise<T[]>;
      })
    );
  }

  return (await Promise.all(requests)).flat();
}

export function fetchCalendarShows(
  clientId: string,
  accessToken: string,
  pastDays: number,
  futureDays: number,
  premieresOnly: boolean = false
): Promise<CalendarShow[]> {
  const kind = premieresOnly ? "shows/premieres" : "shows";
  return fetchCalendarRange(kind, clientId, accessToken, pastDays, futureDays);
}

export function fetchCalendarMovies(
  clientId: string,
  accessToken: string,
  pastDays: number,
  futureDays: number
): Promise<CalendarMovie[]> {
  return fetchCalendarRange("movies", clientId, accessToken, pastDays, futureDays);
}

export async function fetchWatchlistMovies(
  clientId: string,
  accessToken: string
): Promise<WatchlistMovie[]> {
  const res = await fetch(
    `${TRAKT_API}/users/me/watchlist/movies?extended=full`,
    { headers: headers(clientId, accessToken) }
  );

  if (!res.ok) {
    throw new Error(`Failed to fetch watchlist movies: ${res.status}`);
  }

  return res.json();
}

export async function fetchWatchlistShows(
  clientId: string,
  accessToken: string
): Promise<WatchlistShow[]> {
  const res = await fetch(
    `${TRAKT_API}/users/me/watchlist/shows?extended=full`,
    { headers: headers(clientId, accessToken) }
  );

  if (!res.ok) {
    throw new Error(`Failed to fetch watchlist shows: ${res.status}`);
  }

  return res.json();
}

export async function fetchWatchedHistory(
  clientId: string,
  accessToken: string,
  opts: { limit?: number; maxPages?: number } = {}
): Promise<TraktHistoryEntry[]> {
  const limit = opts.limit ?? 1000;
  const maxPages = opts.maxPages ?? 25;
  const all: TraktHistoryEntry[] = [];

  let page = 1;
  let pageCount = 1;
  while (page <= pageCount && page <= maxPages) {
    const res = await fetch(
      `${TRAKT_API}/sync/history/movies?page=${page}&limit=${limit}`,
      { headers: headers(clientId, accessToken) }
    );
    if (!res.ok) {
      throw new Error(
        `Failed to fetch watched history (page ${page}): ${res.status}`
      );
    }
    const chunk = (await res.json()) as TraktHistoryEntry[];
    all.push(...chunk);
    const headerCount = Number(res.headers.get("X-Pagination-Page-Count"));
    if (Number.isFinite(headerCount) && headerCount > 0) {
      pageCount = headerCount;
    }
    if (chunk.length === 0) break;
    page += 1;
  }
  return all;
}

export async function fetchMovieRatings(
  clientId: string,
  accessToken: string
): Promise<TraktMovieRating[]> {
  const res = await fetch(`${TRAKT_API}/sync/ratings/movies`, {
    headers: headers(clientId, accessToken),
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch movie ratings: ${res.status}`);
  }

  return res.json();
}

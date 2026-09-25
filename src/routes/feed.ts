import { Hono } from "hono";
import type { AppEnv, CalendarMovie, CalendarShow } from "../lib/types";
import { getUserByFeedToken } from "../db/queries";
import { getValidAccessToken } from "../lib/auth";
import { fetchCalendarShows, fetchCalendarMovies } from "../lib/trakt";
import { generateCalendar } from "../lib/ical";
import {
  COMBINED_CALENDAR_NAME,
  DEFAULT_FUTURE_DAYS,
  DEFAULT_PAST_DAYS,
  MAX_FUTURE_DAYS,
  MAX_PAST_DAYS,
  getFeed,
} from "../lib/feeds";

const feed = new Hono<AppEnv>();

function parseDays(value: string | undefined, fallback: number, max: number): number {
  const n = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, max);
}

feed.get("/:feedToken", async (c) => {
  const feedToken = c.req.param("feedToken");
  const user = await getUserByFeedToken(c.env.DB, feedToken);

  if (!user) {
    return c.text("Not found", 404);
  }

  // No ?type= means the original combined shows + movies feed.
  const typeParam = c.req.query("type");
  const feedDef = getFeed(typeParam);
  if (typeParam !== undefined && !feedDef) {
    return c.text("Unknown feed type", 400);
  }

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(c.env, user, new URL(c.req.url).origin);
  } catch (e) {
    console.error("Token refresh failed:", e);
    return c.text("Token refresh failed — please re-authenticate", 401);
  }

  try {
    const pastDays = parseDays(c.req.query("past"), DEFAULT_PAST_DAYS, MAX_PAST_DAYS);
    const futureDays = parseDays(c.req.query("future"), DEFAULT_FUTURE_DAYS, MAX_FUTURE_DAYS);
    const clientId = c.env.TRAKT_CLIENT_ID;
    const type = feedDef?.type;

    const noShows: Promise<CalendarShow[]> = Promise.resolve([]);
    const noMovies: Promise<CalendarMovie[]> = Promise.resolve([]);
    const [shows, movies] = await Promise.all([
      type === "movies"
        ? noShows
        : fetchCalendarShows(clientId, accessToken, pastDays, futureDays, type === "premieres"),
      type === undefined || type === "movies"
        ? fetchCalendarMovies(clientId, accessToken, pastDays, futureDays)
        : noMovies,
    ]);

    const allDay = c.req.query("allday") === "1";
    const name = feedDef?.calendarName ?? COMBINED_CALENDAR_NAME;
    const ical = generateCalendar(name, shows, movies, allDay);
    const filename = type ? `trakt-${type}.ics` : "trakt.ics";

    return c.body(ical, 200, {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    });
  } catch (e) {
    console.error("Feed generation failed:", e);
    return c.text("Failed to generate feed", 500);
  }
});

export default feed;

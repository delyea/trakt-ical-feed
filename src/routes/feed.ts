import { Hono } from "hono";
import type { AppEnv } from "../lib/types";
import { getUserByFeedToken } from "../db/queries";
import { getValidAccessToken } from "../lib/auth";
import { fetchCalendarShows, fetchCalendarMovies } from "../lib/trakt";
import { generateCalendar } from "../lib/ical";

const feed = new Hono<AppEnv>();

// Defaults and caps for the ?past= / ?future= day ranges. The caps keep the
// number of Trakt requests (2 per 33 days) well under the Workers
// free-plan limit of 50 subrequests per invocation.
const DEFAULT_PAST_DAYS = 30;
const DEFAULT_FUTURE_DAYS = 90;
const MAX_PAST_DAYS = 180;
const MAX_FUTURE_DAYS = 365;

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

    const [shows, movies] = await Promise.all([
      fetchCalendarShows(c.env.TRAKT_CLIENT_ID, accessToken, pastDays, futureDays),
      fetchCalendarMovies(c.env.TRAKT_CLIENT_ID, accessToken, pastDays, futureDays),
    ]);

    const allDay = c.req.query("allday") === "1";
    const ical = generateCalendar(shows, movies, allDay);

    return c.body(ical, 200, {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="trakt.ics"',
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    });
  } catch (e) {
    console.error("Feed generation failed:", e);
    return c.text("Failed to generate feed", 500);
  }
});

export default feed;

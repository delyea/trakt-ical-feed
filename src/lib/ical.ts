import ical from "ical-generator";
import dayjs from "dayjs";
import type { CalendarShow, CalendarMovie } from "./types";

export function generateCalendar(
  name: string,
  shows: CalendarShow[],
  movies: CalendarMovie[],
  allDay: boolean = false
): string {
  const calendar = ical({ name, timezone: "UTC" });
  // Adjacent calendar chunks can return the same item at their boundary.
  const seen = new Set<string>();

  for (const item of shows) {
    if (!item.first_aired) continue;
    const uid = `trakt-show-${item.episode.ids.trakt}`;
    if (seen.has(uid)) continue;
    seen.add(uid);

    const event = calendar.createEvent({
      start: dayjs(item.first_aired).toDate(),
      summary: `${item.show.title} S${String(item.episode.season).padStart(2, "0")}E${String(item.episode.number).padStart(2, "0")}`,
      description: item.episode.title ?? "",
      allDay,
    });
    event.uid(uid);
  }

  for (const item of movies) {
    const releaseDate = item.released || item.movie?.released;
    if (!releaseDate) continue;
    const uid = `trakt-movie-${item.movie.ids.trakt}`;
    if (seen.has(uid)) continue;
    seen.add(uid);

    const event = calendar.createEvent({
      start: dayjs(releaseDate).toDate(),
      summary: item.movie.title,
      allDay: true,
    });
    event.uid(uid);
  }

  return calendar.toString();
}

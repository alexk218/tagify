// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrackData } from "@/types/tagData";
import { calendarYearRange, countSongsFirstTaggedInYear } from "../libraryStats";

const RealDate = Date;
/**
 * Stands the test on a device whose clock is `hours` from UTC. A test worker can't change its own
 * time zone, so local dates built from parts (`new Date(2026, 0, 1)`) are placed by this offset.
 */
function onClock(hours: number) {
  class ZonedDate extends RealDate {
    constructor(...parts: unknown[]) {
      if (parts.length >= 2) super(RealDate.UTC(...(parts as [number, number])) - hours * 3_600_000);
      else super(...(parts as []));
    }
  }
  vi.stubGlobal("Date", ZonedDate);
}
const TORONTO_WINTER = -5, UTC = 0, KIRITIMATI = 14, NIUE = -11;
afterEach(() => { vi.unstubAllGlobals(); });

const song = (dateCreated: number | undefined, overrides: Partial<TrackData> = {}): TrackData =>
  ({ rating: 0, energy: 0, bpm: null, tagIds: ["tag"], dateCreated, ...overrides });
const count = (...dates: Array<number | undefined>) =>
  countSongsFirstTaggedInYear(Object.fromEntries(dates.map((date, index) => [`spotify:track:${index}`, song(date)])), 2026);
const iso = (timestamp: number) => new RealDate(timestamp).toISOString();

describe("a calendar year on this device's clock", () => {
  it("runs from midnight on January 1 up to, not including, the next January 1", () => {
    onClock(TORONTO_WINTER);
    const { start, end } = calendarYearRange(2026);
    expect(iso(start)).toBe("2026-01-01T05:00:00.000Z");
    expect(iso(end)).toBe("2027-01-01T05:00:00.000Z");
    expect(count(start - 1, start, end - 1, end)).toBe(2);
  });

  it("puts a late December 31 evening in the year it is where the person lives", () => {
    // 11:30 pm on December 31, 2025 in Toronto: still 2025 there, already 2026 in UTC.
    const newYearsEve = RealDate.parse("2026-01-01T04:30:00.000Z");
    onClock(TORONTO_WINTER);
    expect(count(newYearsEve)).toBe(0);
    onClock(UTC);
    expect(count(newYearsEve)).toBe(1);

    // 10 pm on December 31, 2026 in Toronto: still 2026 there, already 2027 in UTC.
    const nextNewYearsEve = RealDate.parse("2027-01-01T03:00:00.000Z");
    onClock(TORONTO_WINTER);
    expect(count(nextNewYearsEve)).toBe(1);
    onClock(UTC);
    expect(count(nextNewYearsEve)).toBe(0);
  });

  it("holds at both ends of the world's clocks", () => {
    onClock(KIRITIMATI);
    expect(iso(calendarYearRange(2026).start)).toBe("2025-12-31T10:00:00.000Z");
    expect(count(RealDate.parse("2025-12-31T09:59:59.999Z"), RealDate.parse("2025-12-31T10:00:00.000Z"), RealDate.parse("2026-12-31T10:00:00.000Z"))).toBe(1);
    onClock(NIUE);
    expect(iso(calendarYearRange(2026).start)).toBe("2026-01-01T11:00:00.000Z");
    expect(count(RealDate.parse("2026-01-01T10:59:59.999Z"), RealDate.parse("2026-01-01T11:00:00.000Z"), RealDate.parse("2027-01-01T10:59:59.999Z"))).toBe(2);
  });

  it("is a whole year on this machine's own clock, through its clock changes", () => {
    const { start, end } = calendarYearRange(2026);
    expect(new Date(start).getFullYear()).toBe(2026);
    expect(new Date(end - 1).getFullYear()).toBe(2026);
    expect(new Date(end).getFullYear()).toBe(2027);
    expect(count(new Date(2026, 2, 8, 2, 30).getTime(), new Date(2026, 10, 1, 1, 30).getTime(), new Date(2026, 11, 31, 23, 59, 59, 999).getTime())).toBe(3);
  });
});

describe("songs first tagged in a year", () => {
  it("counts songs that carry a tag, by their own first-tagged date", () => {
    const june = new Date(2026, 5, 14, 12).getTime();
    const tracks: Record<string, TrackData> = {
      "spotify:track:tagged": song(june),
      "spotify:local:Artist:Album:Song:200": song(june),
      // First tagged in 2025 and changed in 2026: still 2025's.
      "spotify:track:older": song(new Date(2025, 5, 14).getTime(), { dateModified: june }),
      "spotify:track:rated-only": song(june, { tagIds: [], rating: 4.5 }),
      "spotify:track:energy-only": song(june, { tagIds: [], energy: 7 }),
      "spotify:track:undated": song(undefined),
    };
    expect(countSongsFirstTaggedInYear(tracks, 2026)).toBe(2);
    expect(countSongsFirstTaggedInYear(tracks, 2025)).toBe(1);
    expect(countSongsFirstTaggedInYear(tracks, 2027)).toBe(0);
    expect(countSongsFirstTaggedInYear({}, 2026)).toBe(0);
  });

  it("changes no song's dates", () => {
    const tracks = { "spotify:track:1": song(new Date(2026, 5, 14).getTime(), { dateModified: new Date(2026, 6, 1).getTime() }) };
    const before = JSON.stringify(tracks);
    countSongsFirstTaggedInYear(tracks, 2026);
    expect(JSON.stringify(tracks)).toBe(before);
  });
});

import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { storageService } from "@/services/storage";
import { spotifyService, type TrackInfo } from "@/services/SpotifyService";
import { spotifyBackgroundPolicy } from "@/services/SpotifyBackgroundPolicy";
import { defaultTagData } from "@/constants/defaultTagData";
import { TAG_DATA_SCHEMA_VERSION } from "@/utils/tagTaxonomy";
import type { TagDataStructure } from "@/types/tagData";
import { evaluateTrackMatchesCriteria } from "@/features/smart-playlists";
import { MAX_SONG_DETAILS_ATTEMPTS, needsSongDetails, runSongDetailsFill, SONG_DETAILS_RETRY_AFTER_MS } from "../songDetailsFill";

const short = `spotify:track:${"a".repeat(22)}`;
const long = `spotify:track:${"b".repeat(22)}`;
const local = "spotify:local:Artist:Album:Song:200";
const library = (): TagDataStructure => ({
  ...JSON.parse(JSON.stringify(defaultTagData)),
  schemaVersion: TAG_DATA_SCHEMA_VERSION,
  tracks: {
    [short]: { name: "Short", artists: "A", rating: 4, energy: 0, bpm: 120, tagIds: ["rock"], dateCreated: 1_000, dateModified: 1_000 },
    [long]: { name: "Long", artists: "B", rating: 0, energy: 6, bpm: null, tagIds: ["rock"], dateCreated: 2_000, dateModified: 2_000 },
    [local]: { rating: 3, energy: 0, bpm: null, tagIds: [], dateCreated: 3_000, dateModified: 3_000 },
  },
});
const info = (durationMs: number, releaseDate: string | null) => ({ name: "x", artists: "x", duration_ms: durationMs, release_date: "", releaseDate } as unknown as TrackInfo);
const criteria = { includeTagClauses: [], clauseConnectors: [], ratingFilters: [], energyMinFilter: null, energyMaxFilter: null, bpmMinFilter: null, bpmMaxFilter: null };

beforeEach(async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  localStorage.clear();
  expect(await indexedDBStorage.init()).toBe(true);
  expect(await indexedDBStorage.saveAll(library())).toBe(true);
});

afterEach(() => {
  indexedDBStorage.resetConnection();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("fills song lengths and release dates without changing Last Updated, so length and year filters match", async () => {
  vi.spyOn(spotifyService, "getTrack").mockImplementation(async (uri) =>
    uri === short ? info(185_000, "1999-04-12") : info(512_000, "2021"));

  const result = await runSongDetailsFill({ paceMs: 0 });

  expect(result).toMatchObject({ updated: 2, reads: 2, remaining: 0 });
  expect(spotifyService.getTrack).not.toHaveBeenCalledWith(local, expect.anything(), expect.anything(), expect.anything());
  const tracks = (await storageService.loadAll())!.tracks;
  expect(tracks[short]).toMatchObject({ durationMs: 185_000, releaseDate: "1999-04-12", dateModified: 1_000, rating: 4, bpm: 120, tagIds: ["rock"] });
  expect(tracks[long]).toMatchObject({ durationMs: 512_000, releaseDate: "2021", dateModified: 2_000, energy: 6 });
  expect(tracks[short].songDetailsAttempts).toBeUndefined();

  const underFourMinutes = { ...criteria, lengthMaxFilter: 240 };
  expect(evaluateTrackMatchesCriteria(tracks[short], underFourMinutes)).toBe(true);
  expect(evaluateTrackMatchesCriteria(tracks[long], underFourMinutes)).toBe(false);
  const nineties = { ...criteria, releaseYearMinFilter: 1990, releaseYearMaxFilter: 1999 };
  expect(evaluateTrackMatchesCriteria(tracks[short], nineties)).toBe(true);
  expect(evaluateTrackMatchesCriteria(tracks[long], nineties)).toBe(false);

  // Nothing left to look up.
  expect(await runSongDetailsFill({ paceMs: 0 })).toMatchObject({ reads: 0, updated: 0 });
});

it("keeps tags added while a lookup is in flight", async () => {
  let finish!: () => void;
  const lookup = new Promise<void>((resolve) => { finish = resolve; });
  vi.spyOn(spotifyService, "getTrack").mockImplementation(async (uri) => {
    if (uri === long) await lookup;
    return info(200_000, "2010");
  });
  const run = runSongDetailsFill({ paceMs: 0 });
  await vi.waitFor(() => expect(spotifyService.getTrack).toHaveBeenCalledWith(long, undefined, "background", "song-details"));
  const current = (await storageService.loadAll())!.tracks[long];
  await storageService.saveTracks(new Map([[long, { ...current, tagIds: ["rock", "jazz"], dateModified: 9_000 }]]));
  finish();
  await run;
  expect((await storageService.loadAll())!.tracks[long]).toMatchObject({ tagIds: ["rock", "jazz"], dateModified: 9_000, durationMs: 200_000, releaseDate: "2010" });
});

it("stops retrying a song Spotify can't describe after a few attempts", async () => {
  vi.spyOn(spotifyService, "getTrack").mockResolvedValue(null);
  for (let attempt = 1; attempt <= MAX_SONG_DETAILS_ATTEMPTS; attempt += 1) {
    localStorage.clear(); // a new hour's allowance
    await runSongDetailsFill({ paceMs: 0 });
    expect((await storageService.loadAll())!.tracks[short]).toMatchObject({ songDetailsAttempts: attempt, dateModified: 1_000 });
  }
  vi.mocked(spotifyService.getTrack).mockClear();
  localStorage.clear();
  expect(await runSongDetailsFill({ paceMs: 0 })).toMatchObject({ reads: 0 });
  expect(spotifyService.getTrack).not.toHaveBeenCalled();
});

it("tries a song it gave up on again a month later, and keeps Last Updated", async () => {
  vi.spyOn(spotifyService, "getTrack").mockResolvedValue(null);
  const start = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(start);
  for (let attempt = 1; attempt <= MAX_SONG_DETAILS_ATTEMPTS; attempt += 1) {
    localStorage.clear();
    await runSongDetailsFill({ paceMs: 0 });
  }
  expect((await storageService.loadAll())!.tracks[short]).toMatchObject({ songDetailsAttempts: MAX_SONG_DETAILS_ATTEMPTS, songDetailsCheckedAt: start });

  // A day short of a month: still resting.
  vi.mocked(Date.now).mockReturnValue(start + SONG_DETAILS_RETRY_AFTER_MS - 24 * 60 * 60_000);
  vi.mocked(spotifyService.getTrack).mockClear();
  localStorage.clear();
  expect(await runSongDetailsFill({ paceMs: 0 })).toMatchObject({ reads: 0 });
  expect(spotifyService.getTrack).not.toHaveBeenCalled();

  // A month on, Spotify knows it.
  const later = start + SONG_DETAILS_RETRY_AFTER_MS;
  vi.mocked(Date.now).mockReturnValue(later);
  vi.mocked(spotifyService.getTrack).mockImplementation(async (uri) => uri === short ? info(185_000, "1999") : null);
  localStorage.clear();
  await runSongDetailsFill({ paceMs: 0 });
  const tracks = (await storageService.loadAll())!.tracks;
  expect(tracks[short]).toMatchObject({ durationMs: 185_000, releaseDate: "1999", dateModified: 1_000 });
  expect(tracks[short]).not.toHaveProperty("songDetailsAttempts");
  expect(tracks[short]).not.toHaveProperty("songDetailsCheckedAt");
  // Still unknown: one more try used, then another month's rest.
  expect(tracks[long]).toMatchObject({ songDetailsAttempts: MAX_SONG_DETAILS_ATTEMPTS + 1, songDetailsCheckedAt: later, dateModified: 2_000 });
  expect(needsSongDetails(long, tracks[long], later + 1)).toBe(false);
});

it("gives songs given up on before Tagify kept the date their next try now", () => {
  const track = { rating: 0, energy: 0, bpm: null, tagIds: [], songDetailsAttempts: MAX_SONG_DETAILS_ATTEMPTS };
  expect(needsSongDetails(short, track)).toBe(true);
  expect(needsSongDetails(short, { ...track, songDetailsCheckedAt: Date.now() })).toBe(false);
  expect(needsSongDetails(short, { ...track, durationMs: 1_000, releaseDate: "2000" })).toBe(false);
});

it("doesn't use up a song's tries when the lookup itself fails", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(spotifyService, "getTrack").mockRejectedValue(new TypeError("Failed to fetch"));
  for (let run = 0; run <= MAX_SONG_DETAILS_ATTEMPTS; run += 1) {
    localStorage.clear(); // a new hour's allowance
    await runSongDetailsFill({ paceMs: 0 });
  }
  const track = (await storageService.loadAll())!.tracks[short];
  expect(track.songDetailsAttempts).toBeUndefined();
  expect(track.dateModified).toBe(1_000);

  vi.mocked(spotifyService.getTrack).mockResolvedValue(info(200_000, "2010"));
  localStorage.clear();
  await runSongDetailsFill({ paceMs: 0 });
  expect((await storageService.loadAll())!.tracks[short]).toMatchObject({ durationMs: 200_000, dateModified: 1_000 });
});

it("shows each saved batch right away instead of waiting for the whole run", async () => {
  const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [
    `spotify:track:${String(i).padStart(22, "c")}`,
    { name: `Song ${i}`, artists: "C", rating: 3, energy: 0, bpm: null, tagIds: ["rock"], dateCreated: 4_000 + i, dateModified: 4_000 + i },
  ]));
  expect(await indexedDBStorage.saveAll({ ...library(), tracks: { ...library().tracks, ...many } })).toBe(true);
  vi.spyOn(spotifyService, "getTrack").mockResolvedValue(info(200_000, "2010"));
  const onSaved = vi.fn();
  const result = await runSongDetailsFill({ paceMs: 0, onSaved });
  // 32 Spotify songs: one batch of 25 mid-run, then the last 7 at the end.
  expect(result.updated).toBe(32);
  expect(onSaved).toHaveBeenCalledTimes(2);
});

it("stops when the hour's allowance is used up and keeps what it found", async () => {
  vi.spyOn(spotifyService, "getTrack").mockResolvedValue(info(200_000, "2010"));
  const reserve = vi.spyOn(spotifyBackgroundPolicy, "reserve").mockReturnValueOnce(true).mockReturnValue(false);
  const result = await runSongDetailsFill({ paceMs: 0 });
  expect(reserve).toHaveBeenCalledWith("song-details", long, 150);
  expect(result).toMatchObject({ reads: 1, updated: 1, remaining: 1, stopped: "budget" });
});

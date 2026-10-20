import { describe, expect, it, vi } from "vitest";
import { canSaveToLikedSongs, runSpotifySaves, saveClaimedSongs, spotifySaveNotice, type LikedSongsWriter } from "../SpotifySaveRunner";
import { desktopFeatures, pullSideDocuments } from "../SyncRuntime";

const entity = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const trackId = (n: number) => `S${String(n).padStart(21, "0")}`;
const song = (n: number) => ({ id: entity(n), trackId: trackId(n) });
const session = async () => ({ apiBaseUrl: "https://community.example", accessToken: "token", deviceId: "11111111-1111-4111-8111-111111111111" });

/** Spotify's Liked Songs, as the desktop app reports and changes them. */
function likedSongs(initial: string[] = [], options: { addFails?: unknown; containsFails?: unknown } = {}) {
  const saved = new Set(initial);
  const writer: LikedSongsWriter = {
    likedSongsContain: vi.fn(async (uris: string[]) => {
      if (options.containsFails) throw options.containsFails;
      return uris.map((uri) => saved.has(uri));
    }),
    saveToLikedSongs: vi.fn(async (uris: string[]) => {
      if (options.addFails) throw options.addFails;
      uris.forEach((uri) => saved.add(uri));
    }),
  };
  return { saved, writer };
}

/** A Community that hands out `queue` in claims of 50 and records each report. */
function community(queue: Array<{ id: string; trackId: string }>, options: { claimStatus?: number; finishStatus?: number } = {}) {
  const reports: Array<Array<Record<string, unknown>>> = [];
  const request = vi.fn(async (url: string, init: RequestInit) => {
    expect(new URL(url).pathname).toBe("/api/v2/sync/spotify-saves");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.deviceId).toBe("11111111-1111-4111-8111-111111111111");
    if (init.method === "POST") {
      if (options.claimStatus) return new Response("{}", { status: options.claimStatus });
      return new Response(JSON.stringify({ saves: queue.splice(0, 50) }), { status: 200 });
    }
    if (options.finishStatus) return new Response("{}", { status: options.finishStatus });
    reports.push(body.results as Array<Record<string, unknown>>);
    return new Response(JSON.stringify({ finished: (body.results as unknown[]).length }), { status: 200 });
  });
  return { reports, request: request as unknown as typeof fetch };
}

describe("Saving songs from Community to Liked Songs", () => {
  it("is offered only when Spotify's desktop app can save and check Liked Songs", () => {
    expect(canSaveToLikedSongs({ LibraryAPI: { add: () => undefined, contains: () => undefined } })).toBe(true);
    expect(canSaveToLikedSongs({ LibraryAPI: { getTracks: () => undefined } })).toBe(false);
    expect(canSaveToLikedSongs({})).toBe(false);
    // A Spotify that can't play by URI, so only the library features are reported.
    const noPlayer = {};
    expect(desktopFeatures({ LibraryAPI: { add: () => undefined, contains: () => undefined } }, noPlayer)).toEqual(["spotifySaves"]);
    expect(desktopFeatures({
      LibraryAPI: { add: () => undefined, contains: () => undefined, getTracks: () => undefined },
      RootlistAPI: { getContents: () => undefined }, PlaylistAPI: { getContents: () => undefined },
    }, noPlayer)).toEqual(["spotifyLists", "spotifySaves"]);
  });

  it("hears from a pull when songs are waiting", () => {
    expect(pullSideDocuments({ sideDocuments: { localFilesRevision: 1, privateNotesCursor: 2, spotifySavesWaiting: true } })).toMatchObject({ spotifySavesWaiting: true });
    expect(pullSideDocuments({ sideDocuments: { localFilesRevision: 1, privateNotesCursor: 2 } })).not.toHaveProperty("spotifySavesWaiting");
  });

  it("adds only songs not already saved, and checks they arrived", async () => {
    const { saved, writer } = likedSongs([`spotify:track:${trackId(2)}`]);
    const results = await saveClaimedSongs(writer, [song(1), song(2)]);
    expect(writer.saveToLikedSongs).toHaveBeenCalledWith([`spotify:track:${trackId(1)}`]);
    expect(saved.has(`spotify:track:${trackId(1)}`)).toBe(true);
    expect(results).toEqual([{ id: entity(1), result: "saved" }, { id: entity(2), result: "already_saved" }]);
  });

  it("reports why Spotify didn't save, and counts a save Spotify accepted but couldn't confirm", async () => {
    const busy = likedSongs([], { addFails: Object.assign(new Error("Spotify needs a short break."), { status: 429 }) });
    expect(await saveClaimedSongs(busy.writer, [song(1)])).toEqual([{ id: entity(1), result: "failed", failure: "spotify_busy" }]);

    const unreadable = likedSongs([], { containsFails: new Error("offline") });
    expect(await saveClaimedSongs(unreadable.writer, [song(1)])).toEqual([{ id: entity(1), result: "failed", failure: "spotify_unavailable" }]);
    expect(unreadable.writer.saveToLikedSongs).not.toHaveBeenCalled();

    const { writer } = likedSongs();
    vi.mocked(writer.likedSongsContain).mockResolvedValueOnce([false]).mockRejectedValueOnce(new Error("offline"));
    expect(await saveClaimedSongs(writer, [song(1)])).toEqual([{ id: entity(1), result: "saved" }]);
  });

  it("takes every waiting song, 50 at a time, and reports each one", async () => {
    const queue = Array.from({ length: 60 }, (_, index) => song(index + 1));
    const { reports, request } = community(queue);
    const { writer } = likedSongs([`spotify:track:${trackId(3)}`]);
    const run = await runSpotifySaves(session, writer, request);
    expect(run).toEqual({ saved: 59, alreadySaved: 1, failed: 0 });
    expect(reports.map((report) => report.length)).toEqual([50, 10]);
    expect(reports[0][2]).toEqual({ id: entity(3), result: "already_saved" });
  });

  it("skips songs Community describes badly instead of saving something else", async () => {
    const { reports, request } = community([song(1), { id: "not-an-id", trackId: trackId(2) }, { id: entity(3), trackId: "spotify:track:x" }]);
    const { writer } = likedSongs();
    expect(await runSpotifySaves(session, writer, request)).toEqual({ saved: 1, alreadySaved: 0, failed: 0 });
    expect(reports).toEqual([[{ id: entity(1), result: "saved" }]]);
  });

  it.each([
    [404, "unsupported"],
    [503, "paused"],
    [401, "signed_out"],
    [500, "network"],
  ])("stops quietly when Community answers %i", async (status, stopped) => {
    const { request } = community([song(1)], { claimStatus: status });
    const { writer } = likedSongs();
    expect(await runSpotifySaves(session, writer, request)).toEqual({ saved: 0, alreadySaved: 0, failed: 0, stopped });
    expect(writer.saveToLikedSongs).not.toHaveBeenCalled();
  });

  it("stops after a report Community didn't take; those songs are handed out again later", async () => {
    const { request } = community([song(1)], { finishStatus: 500 });
    const { writer } = likedSongs();
    expect(await runSpotifySaves(session, writer, request)).toEqual({ saved: 0, alreadySaved: 0, failed: 0, stopped: "network" });
  });

  it("tells the member what happened in one notification", () => {
    expect(spotifySaveNotice({ saved: 1, alreadySaved: 0, failed: 0 })).toEqual({ text: "Saved a song from Tagify Community to your Liked Songs.", error: false });
    expect(spotifySaveNotice({ saved: 3, alreadySaved: 2, failed: 0 })?.text).toBe("Saved 3 songs from Tagify Community to your Liked Songs.");
    expect(spotifySaveNotice({ saved: 0, alreadySaved: 1, failed: 0 })?.text).toBe("That song is already in your Liked Songs.");
    expect(spotifySaveNotice({ saved: 2, alreadySaved: 0, failed: 1 })).toEqual({ text: "Tagify couldn't save a song to your Liked Songs. Try again on Tagify Community.", error: true });
    expect(spotifySaveNotice({ saved: 0, alreadySaved: 0, failed: 0 })).toBeNull();
  });
});

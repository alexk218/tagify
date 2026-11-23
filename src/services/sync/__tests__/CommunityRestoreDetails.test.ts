import { describe, expect, it, vi } from "vitest";
import { readRestoreDetails, withRestoreDetails } from "../CommunityRestoreDetails";
import type { TagDataStructure } from "@/types/tagData";

const session = { apiBaseUrl: "https://community.test", accessToken: "token", deviceId: "30000000-0000-4000-8000-000000000004" };
const cursor = "51000000-0000-4000-8000-000000000001";
const song = (providerId: string, title: string) => ({
  entity: { provider: "spotify", kind: "track", providerId }, title, artists: "Artist A, Artist B",
  album: { providerId: "6eUW0wxWtzkFdaEFsTJto6", name: "Album One", imageUrl: "https://i.scdn.co/image/album", releaseDate: "2024-06-01" },
  imageUrl: "https://i.scdn.co/image/song",
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("readRestoreDetails", () => {
  it("reads every page of this device's library", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(json({ items: [song("4uLU6hMCjMI75M1A2tKUQC", "One")], nextCursor: cursor }))
      .mockResolvedValueOnce(json({ items: [song("1uLU6hMCjMI75M1A2tKUQC", "Two")], nextCursor: null }));
    const details = await readRestoreDetails(session, { request });
    expect([...details.keys()]).toEqual(["spotify:track:4uLU6hMCjMI75M1A2tKUQC", "spotify:track:1uLU6hMCjMI75M1A2tKUQC"]);
    expect(request.mock.calls[0][0]).toBe(`https://community.test/api/v2/sync/restore-details?deviceId=${session.deviceId}&limit=500`);
    expect(request.mock.calls[1][0]).toContain(`&after=${cursor}`);
    expect(request.mock.calls[0][1].headers).toMatchObject({ authorization: "Bearer token" });
  });

  it("restores without details when Community is older, paused, unreachable or answers nonsense", async () => {
    expect((await readRestoreDetails(session, { request: vi.fn().mockResolvedValue(json({ error: "Not found" }, 404)) })).size).toBe(0);
    expect((await readRestoreDetails(session, { request: vi.fn().mockResolvedValue(json({ items: [], nextCursor: null, paused: true })) })).size).toBe(0);
    expect((await readRestoreDetails(session, { request: vi.fn().mockRejectedValue(new TypeError("offline")) })).size).toBe(0);
    expect((await readRestoreDetails(session, { request: vi.fn().mockResolvedValue(json({ nope: true })) })).size).toBe(0);
  });

  it("keeps what it read before a later page failed", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(json({ items: [song("4uLU6hMCjMI75M1A2tKUQC", "One")], nextCursor: cursor }))
      .mockResolvedValueOnce(json({ error: "Unavailable" }, 503));
    expect((await readRestoreDetails(session, { request })).size).toBe(1);
  });
});

describe("withRestoreDetails", () => {
  const data = (): TagDataStructure => ({
    schemaVersion: 1, taxonomy: {} as TagDataStructure["taxonomy"], smartPlaylists: [],
    tracks: {
      "spotify:track:4uLU6hMCjMI75M1A2tKUQC": { rating: 5, energy: 3, bpm: 77, camelotKey: "7B", tagIds: ["mood"], dateModified: 1700000000000 },
      "spotify:track:9uLU6hMCjMI75M1A2tKUQC": { rating: 4, energy: 0, bpm: null, tagIds: [] },
    },
    playlists: { "spotify:album:6eUW0wxWtzkFdaEFsTJto6": { rating: 4, energy: 0, tagIds: [] } },
    artists: { "spotify:artist:0gxyHStUsqpMadRV0Di1Qt": { rating: 3, energy: 0, tagIds: [] } },
  });

  it("names restored songs, their albums and artists without touching tags, ratings or dates", async () => {
    const details = await readRestoreDetails(session, { request: vi.fn().mockResolvedValue(json({
      items: [song("4uLU6hMCjMI75M1A2tKUQC", "Never Gonna Give You Up"),
        { entity: { provider: "spotify", kind: "artist", providerId: "0gxyHStUsqpMadRV0Di1Qt" }, title: "Rick Astley", artists: null, album: null, imageUrl: "https://i.scdn.co/image/rick" }],
      nextCursor: null,
    })) });
    const next = withRestoreDetails(data(), details);
    expect(next.tracks["spotify:track:4uLU6hMCjMI75M1A2tKUQC"]).toEqual({
      rating: 5, energy: 3, bpm: 77, camelotKey: "7B", tagIds: ["mood"], dateModified: 1700000000000,
      name: "Never Gonna Give You Up", artists: "Artist A, Artist B", albumUri: "spotify:album:6eUW0wxWtzkFdaEFsTJto6",
      albumName: "Album One", albumImageUrl: "https://i.scdn.co/image/album", releaseDate: "2024-06-01",
    });
    // A song Community doesn't know stays for Tagify's own Spotify fill.
    expect(next.tracks["spotify:track:9uLU6hMCjMI75M1A2tKUQC"]).toEqual(data().tracks["spotify:track:9uLU6hMCjMI75M1A2tKUQC"]);
    // The album takes the name a song from it carried.
    expect(next.playlists["spotify:album:6eUW0wxWtzkFdaEFsTJto6"]).toMatchObject({ name: "Album One", imageUrl: "https://i.scdn.co/image/album" });
    expect(next.artists["spotify:artist:0gxyHStUsqpMadRV0Di1Qt"]).toMatchObject({ name: "Rick Astley", imageUrl: "https://i.scdn.co/image/rick" });
  });

  it("leaves the library as it is when Community sent nothing", () => {
    const original = data();
    expect(withRestoreDetails(original, new Map())).toBe(original);
  });
});

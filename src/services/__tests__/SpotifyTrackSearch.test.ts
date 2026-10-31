import { afterEach, describe, expect, it, vi } from "vitest";
import { assertSpotifySearchLookupAnswers } from "@tagify/sync-contracts";
import { parseSpotifyTrackSearch, parseSpotifyTrackSearchItems, resetSpotifyTrackSearchForTests, searchTracksDefinition, searchTracksHashFromScript } from "../SpotifyTrackSearch";

const HASH = "59ee4a659c32e9ad894a71308207594a65ba67bb6b632b183abe97303a51fa55";
// As Spotify 1.2.92.148 registers it in xpui-routes-search.js.
const SCRIPT = `let aI=[],aS=Spicetify.GraphQL.Definitions["searchTracks"]=new E.l("searchTracks","query","${HASH}",null);async function aE(e,t,s){}`;
class Definition { constructor(readonly name: string, readonly operation: string, readonly sha256Hash: string, readonly value: unknown) {} }

const track = (uri: string, name: string, artists: string[], extra: Record<string, unknown> = {}) => ({ item: { __typename: "TrackResponseWrapper", data: {
  __typename: "Track", uri, name, artists: { items: artists.map((artist) => ({ profile: { name: artist }, uri: "spotify:artist:x" })) },
  albumOfTrack: { name: "Baby Love Cry", uri: "spotify:album:2zhHhFgcRNEJxjsshGNj4k" }, playability: { playable: true, reason: "PLAYABLE" }, ...extra,
} }, matchedFields: [] });

afterEach(() => resetSpotifyTrackSearchForTests());

describe("Spotify song search", () => {
  it("reads songs from the live answer's shape and leaves out anything else", () => {
    expect(parseSpotifyTrackSearch({ data: { searchV2: { tracksV2: { totalCount: 301, pagingInfo: { limit: 10, nextOffset: 10 }, items: [
      track("spotify:track:1ArFwgEU2iQMq9dU43sGZ9", "Baby - Tony Romera Remix", ["Four Tet", "Tony Romera"]),
      track("spotify:track:1fLhGF1JfGQYj6EZLndD86", "Baby", ["Clean Bandit"], { albumOfTrack: null, playability: { playable: false } }),
      track("spotify:episode:1fLhGF1JfGQYj6EZLndD86", "Episode", ["Host"]),
      track("spotify:track:2fLhGF1JfGQYj6EZLndD86", "No artists", []),
      { item: { __typename: "NotFound" } },
    ] } } }, extensions: {} })).toEqual([
      { id: "1ArFwgEU2iQMq9dU43sGZ9", name: "Baby - Tony Romera Remix", artists: ["Four Tet", "Tony Romera"], album: "Baby Love Cry", playable: true },
      { id: "1fLhGF1JfGQYj6EZLndD86", name: "Baby", artists: ["Clean Bandit"], album: null, playable: false },
    ]);
  });

  it("lists songs for a member's search with ids, the largest cover and artists with ids", () => {
    const cover = { sources: [
      { url: "https://i.scdn.co/image/300", width: 300, height: 300 }, { url: "https://i.scdn.co/image/64", width: 64, height: 64 },
      { url: "https://i.scdn.co/image/640", width: 640, height: 640 },
    ] };
    const artists = (...entries: Array<[string, string]>) => ({ items: entries.map(([name, uri]) => ({ profile: { name }, uri })) });
    const items = parseSpotifyTrackSearchItems({ data: { searchV2: { tracksV2: { items: [
      track("spotify:track:1eyzqe2QqGZUmfcPZtrIyt", "Midnight City", [], {
        artists: artists(["M83", "spotify:artist:63MQldklfxkjYDoUE4Tppz"], ["Unknown", "spotify:artist:short"]),
        albumOfTrack: { name: "Hurry Up, We're Dreaming", coverArt: cover },
      }),
      track("spotify:track:2eyzqe2QqGZUmfcPZtrIyt", "No cover", [], {
        artists: artists(["M83", "spotify:artist:63MQldklfxkjYDoUE4Tppz"]), albumOfTrack: { coverArt: { sources: [{ url: "http://insecure", width: 640 }] } },
      }),
      track("spotify:track:3eyzqe2QqGZUmfcPZtrIyt", "No artist ids", [], { artists: artists(["M83", "spotify:artist:x"]) }),
      { item: { __typename: "NotFound" } },
    ] } } } });
    expect(items).toEqual([
      { providerId: "1eyzqe2QqGZUmfcPZtrIyt", name: "Midnight City", imageUrl: "https://i.scdn.co/image/640", artists: [{ providerId: "63MQldklfxkjYDoUE4Tppz", name: "M83" }] },
      { providerId: "2eyzqe2QqGZUmfcPZtrIyt", name: "No cover", imageUrl: null, artists: [{ providerId: "63MQldklfxkjYDoUE4Tppz", name: "M83" }] },
    ]);
    expect(() => assertSpotifySearchLookupAnswers({ protocolVersion: 1, deviceId: "11111111-1111-4111-8111-111111111111", answers: [{ requestId: "r", items }] })).not.toThrow();
    expect(parseSpotifyTrackSearchItems({ errors: [{ message: "PersistedQueryNotFound" }] })).toBeNull();
  });

  it("treats errors and unknown shapes as no answer", () => {
    expect(parseSpotifyTrackSearch({ errors: [{ message: "PersistedQueryNotFound" }] })).toBeNull();
    expect(parseSpotifyTrackSearch({ data: { searchV2: {} } })).toBeNull();
    expect(parseSpotifyTrackSearch({ data: { searchV2: { tracksV2: { items: [] } } } })).toEqual([]);
  });

  it("uses Spotify's own definition once its Search page has run", async () => {
    const registered = new Definition("searchTracks", "query", HASH, null);
    const readScript = vi.fn();
    expect(await searchTracksDefinition({ definitions: { searchTracks: registered }, readScript })).toBe(registered);
    expect(readScript).not.toHaveBeenCalled();
  });

  it("otherwise builds Spotify's definition from its bundled search script, with the class Spotify uses", async () => {
    expect(searchTracksHashFromScript(SCRIPT)).toBe(HASH);
    const readScript = vi.fn(async () => SCRIPT);
    const definitions = { getTrack: new Definition("getTrack", "query", "a".repeat(64), null) };
    const built = await searchTracksDefinition({ definitions, readScript });
    expect(built).toBeInstanceOf(Definition);
    expect(built).toMatchObject({ name: "searchTracks", operation: "query", sha256Hash: HASH, value: null });
    await searchTracksDefinition({ definitions, readScript });
    expect(readScript).toHaveBeenCalledTimes(1);
  });

  it("never makes up a definition, and reads the script again only after a while", async () => {
    let now = 0;
    const readScript = vi.fn(async () => "no registration here");
    expect(await searchTracksDefinition({ definitions: {}, readScript, now: () => now })).toBeNull();
    expect(searchTracksHashFromScript(`Definitions["searchTracks"]=new E.l("searchTracks","query","short",null)`)).toBeNull();
    now = 60_000;
    expect(await searchTracksDefinition({ definitions: {}, readScript, now: () => now })).toBeNull();
    expect(readScript).toHaveBeenCalledTimes(1);
    now = 10 * 60_000;
    readScript.mockResolvedValueOnce(SCRIPT);
    expect(await searchTracksDefinition({ definitions: {}, readScript, now: () => now })).toEqual({ name: "searchTracks", operation: "query", sha256Hash: HASH, value: null });
  });
});

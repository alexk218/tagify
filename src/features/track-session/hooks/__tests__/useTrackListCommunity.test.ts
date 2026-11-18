import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaggedByOthersLookupError, type TaggedByOthersItem } from "@/features/community/taggedByOthers/taggedByOthersScan";
import { forgetTrackListCommunity, lookupTrackListCommunity, spotifyIdOf, TRACK_LIST_COMMUNITY_FRESH_MS } from "@/features/track-session/hooks/useTrackListCommunity";

const item = (providerId: string, people = 2): TaggedByOthersItem => ({
  providerId, people, peopleCapped: false, sample: [], tags: [{ label: "techno", paths: ["techno"], people }],
});
const songIds = (count: number) => Array.from({ length: count }, (_, index) => `song${String(index).padStart(8, "0")}`);

describe("lookupTrackListCommunity", () => {
  beforeEach(() => forgetTrackListCommunity());

  it("asks in batches and doesn't ask again within the hour", async () => {
    const lookup = vi.fn(async (songs: string[]) => songs.slice(0, 1).map((id) => item(id)));
    let now = 1_000;
    const ids = songIds(5);
    expect(await lookupTrackListCommunity(ids, { account: "a", lookup, batchSize: 2, now: () => now })).toBeNull();
    expect(lookup.mock.calls.map(([songs]) => songs.length)).toEqual([2, 2, 1]);

    await lookupTrackListCommunity(ids, { account: "a", lookup, batchSize: 2, now: () => now });
    expect(lookup).toHaveBeenCalledTimes(3);

    now += TRACK_LIST_COMMUNITY_FRESH_MS + 1;
    await lookupTrackListCommunity(ids, { account: "a", lookup, batchSize: 2, now: () => now });
    expect(lookup).toHaveBeenCalledTimes(6);
  });

  it("keeps a separate cache per account", async () => {
    const lookup = vi.fn(async () => []);
    await lookupTrackListCommunity(songIds(1), { account: "a", lookup });
    await lookupTrackListCommunity(songIds(1), { account: "b", lookup });
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("stops at the first batch Community can't answer and keeps what it has", async () => {
    const lookup = vi.fn(async (songs: string[]) => {
      if (songs[0] === "song00000002") throw new TaggedByOthersLookupError("busy");
      return [];
    });
    const stop = await lookupTrackListCommunity(songIds(8), { account: "a", lookup, batchSize: 2 });
    expect(stop).toBe("busy");
    expect(lookup.mock.calls.length).toBeLessThan(4);
  });
});

describe("spotifyIdOf", () => {
  it("reads Spotify track IDs only", () => {
    expect(spotifyIdOf("spotify:track:4uLU6hMCjMI75M1A2tKUQC")).toBe("4uLU6hMCjMI75M1A2tKUQC");
    expect(spotifyIdOf("spotify:local:Artist:Album:Song:123")).toBeNull();
    expect(spotifyIdOf("spotify:episode:4uLU6hMCjMI75M1A2tKUQC")).toBeNull();
  });
});

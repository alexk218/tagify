import { describe, expect, it, vi } from "vitest";
import { PlaylistMembershipStore } from "../playlistMembership";

describe("playlist membership", () => {
  it("deduplicates contributions but retains the displayed playlist length", async () => {
    const lookup = vi.fn().mockResolvedValue(["spotify:track:a", "spotify:track:b", "spotify:track:a"]);
    const store = new PlaylistMembershipStore(lookup);
    await Promise.all([store.request("spotify:playlist:one"), store.request("spotify:playlist:one")]);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()["spotify:playlist:one"]).toMatchObject({ status: "loaded", uris: ["spotify:track:a", "spotify:track:b"], listedTrackCount: 3 });
  });
  it("replaces membership after edits, including a genuinely empty playlist", async () => {
    const lookup = vi.fn().mockResolvedValueOnce(["spotify:track:a", "spotify:track:b"]).mockResolvedValueOnce([]);
    const store = new PlaylistMembershipStore(lookup);
    await store.request("spotify:playlist:one", "old");
    await store.request("spotify:playlist:one", "new");
    expect(store.getSnapshot()["spotify:playlist:one"]).toMatchObject({ status: "loaded", uris: [], listedTrackCount: 0 });
  });
  it("retains last confirmed membership on failure and recovers on retry", async () => {
    const lookup = vi.fn().mockResolvedValueOnce(["spotify:track:a"]).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(["spotify:track:b"]);
    const store = new PlaylistMembershipStore(lookup);
    await store.request("spotify:playlist:one");
    const checkedAt = store.getSnapshot()["spotify:playlist:one"].checkedAt;
    await store.request("spotify:playlist:one", "", true);
    expect(store.getSnapshot()["spotify:playlist:one"]).toMatchObject({ status: "failed", uris: ["spotify:track:a"], checkedAt });
    await store.request("spotify:playlist:one", "", true);
    expect(store.getSnapshot()["spotify:playlist:one"]).toMatchObject({ status: "loaded", uris: ["spotify:track:b"] });
  });
  it("checks a new revision that arrives during a pending read", async () => {
    let finish!: (uris: string[]) => void;
    const lookup = vi.fn().mockImplementationOnce(() => new Promise<string[]>((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce(["spotify:track:b"]);
    const store = new PlaylistMembershipStore(lookup);
    const first = store.request("spotify:playlist:one", "old");
    const changed = store.request("spotify:playlist:one", "new");
    finish(["spotify:track:a"]);
    await Promise.all([first, changed]);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot()["spotify:playlist:one"].uris).toEqual(["spotify:track:b"]);
  });
  it("doesn't include podcast episodes in song coverage", async () => {
    const store = new PlaylistMembershipStore(vi.fn().mockResolvedValue(["spotify:track:a", "spotify:local:artist:album:song:123", "spotify:episode:a"]));
    await store.request("spotify:playlist:one");
    expect(store.getSnapshot()["spotify:playlist:one"].listedTrackCount).toBe(2);
  });
  it("doesn't turn an initial read failure into an empty playlist", async () => {
    const store = new PlaylistMembershipStore(vi.fn().mockRejectedValue(new Error("offline")));
    await store.request("spotify:playlist:one");
    expect(store.getSnapshot()["spotify:playlist:one"]).toEqual({ status: "failed" });
  });
});

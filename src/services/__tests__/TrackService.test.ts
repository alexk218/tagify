import { beforeEach, describe, expect, it, vi } from "vitest";
import { trackService } from "../TrackService";

describe("TrackService playback", () => {
  const play = vi.fn();
  beforeEach(() => {
    play.mockReset().mockResolvedValue(undefined);
    (Spicetify as unknown as { Platform: Record<string, unknown> }).Platform = { ...(Spicetify as unknown as { Platform?: Record<string, unknown> }).Platform, PlayerAPI: { play } };
    vi.mocked(Spicetify.showNotification).mockClear?.();
  });

  it("plays a whole list in order as one Spotify context, local files included", async () => {
    const uris = ["spotify:local:::Song:120", "spotify:track:a", "spotify:track:b"];
    await trackService.playAllFilteredTracks(uris);
    expect(play).toHaveBeenCalledWith(
      { uri: "spotify:app:tagify", pages: [{ items: uris.map((uri) => ({ uri })) }] },
      { featureIdentifier: "tagify" }, {},
    );
    expect(Spicetify.showNotification).toHaveBeenCalledWith("Playing 3 tracks");
  });

  it("splits long lists into pages", async () => {
    const uris = Array.from({ length: 1201 }, (_, index) => `spotify:track:${index}`);
    await trackService.playAllFilteredTracks(uris);
    const context = play.mock.calls[0][0] as { pages: Array<{ items: unknown[] }> };
    expect(context.pages.map((page) => page.items.length)).toEqual([500, 500, 201]);
  });

  it("explains when Spotify can't start the list", async () => {
    play.mockRejectedValue(new Error("busy"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await trackService.playAllFilteredTracks(["spotify:track:a"]);
    expect(Spicetify.showNotification).toHaveBeenCalledWith("Spotify couldn't start these tracks. Try again in a moment.", true);
  });

  it("plays a single local file through a list and other tracks directly", async () => {
    await trackService.playTrack("spotify:local:::Song:120");
    expect(play).toHaveBeenCalledWith({ uri: "spotify:app:tagify", pages: [{ items: [{ uri: "spotify:local:::Song:120" }] }] }, { featureIdentifier: "tagify" }, {});
    await trackService.playTrack("spotify:track:a");
    expect(Spicetify.Player.playUri).toHaveBeenCalledWith("spotify:track:a");
  });
});

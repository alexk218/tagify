import { describe, expect, it, vi } from "vitest";
import {
  LOCK_STATE_KEY,
  LOCKED_TRACK_KEY,
  loadPersistedTrackLockState,
  persistTrackLockState,
} from "@/features/track-session/utils/trackSession.storage";

describe("trackSession.storage", () => {
  it("loads persisted lock state when both keys exist", () => {
    const lockedTrack = {
      uri: "spotify:track:123",
      name: "Track",
      artists: [{ name: "Artist" }],
      album: { name: "Album" },
      duration_ms: 1000,
    };

    vi.mocked(localStorage.getItem)
      .mockReturnValueOnce("true")
      .mockReturnValueOnce(JSON.stringify(lockedTrack));

    const loaded = loadPersistedTrackLockState();

    expect(loaded).toEqual({
      isLocked: true,
      lockedTrack,
    });
  });

  it("returns unlocked defaults when parsing fails", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    vi.mocked(localStorage.getItem)
      .mockReturnValueOnce("true")
      .mockReturnValueOnce("{bad-json");

    const loaded = loadPersistedTrackLockState();

    expect(loaded).toEqual({
      isLocked: false,
      lockedTrack: null,
    });

    consoleErrorSpy.mockRestore();
  });

  it("persists lock state when locked", () => {
    const lockedTrack = {
      uri: "spotify:track:123",
      name: "Track",
      artists: [{ name: "Artist" }],
      album: { name: "Album" },
      duration_ms: 1000,
    };

    persistTrackLockState(true, lockedTrack);

    expect(localStorage.setItem).toHaveBeenCalledWith(LOCK_STATE_KEY, "true");
    expect(localStorage.setItem).toHaveBeenCalledWith(
      LOCKED_TRACK_KEY,
      JSON.stringify(lockedTrack),
    );
  });

  it("clears lock state when unlocked", () => {
    persistTrackLockState(false, null);

    expect(localStorage.removeItem).toHaveBeenCalledWith(LOCK_STATE_KEY);
    expect(localStorage.removeItem).toHaveBeenCalledWith(LOCKED_TRACK_KEY);
  });
});

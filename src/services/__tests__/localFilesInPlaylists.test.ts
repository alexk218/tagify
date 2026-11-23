import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { spotifyApiService } from "../SpotifyApiService";
import { addableHere, localFileAddsAvailable, resetLocalFilesOnThisComputer } from "../localFilesOnThisComputer";

const HERE = "spotify:local:Artist:Album:On+This+Computer:200";
const ELSEWHERE = "spotify:local:Artist:Album:On+Another+Computer:180";
const platform = Spicetify.Platform as any;

beforeEach(() => {
  resetLocalFilesOnThisComputer();
  platform.LocalFilesAPI = { getTracks: vi.fn().mockResolvedValue([{ uri: HERE }]) };
  platform.PlaylistAPI.getContents = vi.fn().mockResolvedValue({ items: [] });
  platform.PlaylistAPI.add = vi.fn();
});
afterEach(() => {
  delete platform.LocalFilesAPI;
  vi.restoreAllMocks();
});

it("adds local files this computer's Spotify lists, after catalog songs, and leaves the rest", async () => {
  const add = vi.spyOn(platform.PlaylistAPI, "add").mockResolvedValue(undefined);
  const result = await spotifyApiService.updatePlaylistTracks("locals", [HERE, "spotify:track:a", ELSEWHERE], []);
  expect(result).toEqual({ success: true, added: ["spotify:track:a", HERE], removed: [] });
  expect(add.mock.calls.map(call => call[1])).toEqual([["spotify:track:a"], [HERE]]);
});

it("keeps catalog additions when Spotify refuses a local file, and stops trying local files", async () => {
  const add = vi.spyOn(platform.PlaylistAPI, "add").mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("refused"));
  const result = await spotifyApiService.updatePlaylistTracks("refused", ["spotify:track:a", HERE], []);
  expect(result).toEqual({ success: true, added: ["spotify:track:a"], removed: [] });
  expect(add).toHaveBeenCalledTimes(2);
  expect(localFileAddsAvailable()).toBe(false);
  expect(await addableHere([HERE])).toEqual({ addable: [], localElsewhere: [HERE] });
});

it("treats every local file as elsewhere when Spotify can't list them", async () => {
  platform.LocalFilesAPI = { getTracks: vi.fn().mockRejectedValue(new Error("disabled")) };
  expect(await addableHere(["spotify:track:a", HERE])).toEqual({ addable: ["spotify:track:a"], localElsewhere: [HERE] });
});

it("never adds a local file already in the playlist", async () => {
  vi.spyOn(platform.PlaylistAPI, "getContents").mockResolvedValue({ items: [{ uri: HERE, uid: "1" }] });
  const add = vi.spyOn(platform.PlaylistAPI, "add").mockResolvedValue(undefined);
  const result = await spotifyApiService.updatePlaylistTracks("present", [HERE], []);
  expect(result).toEqual({ success: true, added: [], removed: [] });
  expect(add).not.toHaveBeenCalled();
});

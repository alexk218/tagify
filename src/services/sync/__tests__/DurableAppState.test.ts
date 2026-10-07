import { beforeEach, describe, expect, it, vi } from "vitest";
import { SMART_PLAYLIST_MEMBERSHIP_BASELINES_KEY } from "@/features/smart-playlists/utils/smartPlaylist.storage";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import {
  applyDurableAppStateDocuments,
  buildDurableAppStateDocuments,
  restoreDurableLocalStateForAccount,
  sanitizeSmartPlaylists,
  stashDurableLocalStateForAccount,
} from "../DurableAppState";

describe("durable cloud app-state boundary", () => {
  beforeEach(() => localStorage.clear());

  it("keeps smart-playlist definitions but strips derived device state", () => {
    expect(sanitizeSmartPlaylists([{
      playlistId: "focus", playlistName: "Focus", criteria: { ratingFilters: [5] }, isActive: true,
      createdAt: 10, lastSyncAt: 20, smartPlaylistTrackUris: ["spotify:local:file"],
    }])).toEqual([{
      playlistId: "focus", playlistName: "Focus", criteria: { ratingFilters: [5] }, isActive: true, createdAt: 10,
    }]);
  });

  it("keeps local-file tag choices on this device while backing up Spotify choices", () => {
    const spotifyUri = "spotify:track:4uLU6hMCjMI75M1A2tKUQC";
    expect(sanitizeSmartPlaylists([{ id: "choice", pendingTagChoices: ["spotify:local:Artist:Album:Song:180", spotifyUri] }]))
      .toEqual([{ id: "choice", pendingTagChoices: [spotifyUri] }]);
  });

  it("drops malformed smart-playlist records", () => {
    expect(sanitizeSmartPlaylists([null, "invalid", 4])).toEqual([]);
  });

  it("includes smart-playlist recipes in every Community app-state backup", async () => {
    vi.spyOn(indexedDBStorage, "getCommunityPublicationPolicy").mockResolvedValue(null);
    vi.spyOn(indexedDBStorage, "getCommunityOwnerIdentityMapping").mockResolvedValue(null);
    vi.spyOn(indexedDBStorage, "getCommunityInstallations").mockResolvedValue([]);
    vi.spyOn(indexedDBStorage, "getAllSmartPlaylists").mockResolvedValue([{
      playlistId: "focus",
      playlistName: "Focus",
      criteria: {
        includeTagClauses: [],
        clauseConnectors: [],
        ratingFilters: [5],
        energyMinFilter: null,
        energyMaxFilter: null,
        bpmMinFilter: null,
        bpmMaxFilter: null,
      },
      isActive: true,
      createdAt: 10,
      lastSyncAt: 20,
      smartPlaylistTrackUris: ["spotify:track:one"],
    }]);

    const document = (await buildDurableAppStateDocuments()).find(
      (candidate) => candidate.domain === "smart-playlists",
    );

    expect(document?.value).toEqual([{
      playlistId: "focus",
      playlistName: "Focus",
      criteria: {
        includeTagClauses: [],
        clauseConnectors: [],
        ratingFilters: [5],
        energyMinFilter: null,
        energyMaxFilter: null,
        bpmMinFilter: null,
        bpmMaxFilter: null,
      },
      isActive: true,
      createdAt: 10,
    }]);
  });

  it("fails restoration instead of silently dropping smart playlists", async () => {
    vi.spyOn(indexedDBStorage, "saveSmartPlaylists").mockResolvedValue(false);

    await expect(applyDurableAppStateDocuments([{
      domain: "smart-playlists",
      value: [{ playlistId: "focus", playlistName: "Focus", criteria: {}, isActive: true, createdAt: 10 }],
      revision: 1,
      updatedAt: "2026-09-18T12:00:00.000Z",
    }])).rejects.toThrow("Failed to save smart playlists");
  });

  it("rejects a damaged rule document before changing the local library", async () => {
    const save = vi.spyOn(indexedDBStorage, "saveSmartPlaylists");

    await expect(applyDurableAppStateDocuments([{
      domain: "smart-playlists",
      value: [{ playlistName: "5★", criteria: { ratingFilters: [5] } }],
      revision: 2,
      updatedAt: "2026-09-23T12:00:00.000Z",
    }])).rejects.toThrow("backup is incomplete");

    expect(save).not.toHaveBeenCalled();
  });

  it("keeps disconnected durable settings isolated by account", () => {
    localStorage.setItem("tagify:extensionSettings", JSON.stringify({ account: "account-a" }));
    stashDurableLocalStateForAccount("account-a");
    localStorage.setItem("tagify:extensionSettings", JSON.stringify({ account: "account-b" }));
    stashDurableLocalStateForAccount("account-b");
    localStorage.setItem(
      SMART_PLAYLIST_MEMBERSHIP_BASELINES_KEY,
      JSON.stringify(["account-b:1"]),
    );

    expect(restoreDurableLocalStateForAccount("account-a")).toBe(true);
    expect(JSON.parse(localStorage.getItem("tagify:extensionSettings") || "{}"))
      .toEqual({ account: "account-a" });
    expect(localStorage.getItem(SMART_PLAYLIST_MEMBERSHIP_BASELINES_KEY)).toBeNull();
    expect(restoreDurableLocalStateForAccount("account-b")).toBe(true);
    expect(JSON.parse(localStorage.getItem("tagify:extensionSettings") || "{}"))
      .toEqual({ account: "account-b" });
  });
});

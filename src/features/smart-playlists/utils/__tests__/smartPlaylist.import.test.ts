import { describe, expect, it } from "vitest";
import { SmartPlaylistCriteria } from "@/features/smart-playlists/model/smartPlaylist.types";
import { mergeImportedSmartPlaylists, prepareSmartPlaylistImport } from "../smartPlaylist.import";

function importedPlaylist(
  overrides: Partial<SmartPlaylistCriteria> = {},
): SmartPlaylistCriteria {
  return {
    playlistId: "old-4-star-id",
    playlistName: "4★",
    criteria: {
      includeTagClauses: [],
      clauseConnectors: [],
      ratingFilters: [4],
      energyMinFilter: null,
      energyMaxFilter: null,
      bpmMinFilter: null,
      bpmMaxFilter: null,
    },
    isActive: true,
    createdAt: 1,
    lastSyncAt: 2,
    smartPlaylistTrackUris: ["spotify:track:stale"],
    ...overrides,
  };
}

describe("prepareSmartPlaylistImport", () => {
  it("relinks a stale ID to the unique current playlist with the same name", () => {
    const result = prepareSmartPlaylistImport(
      [importedPlaylist()],
      [{ playlistId: "current-4-star-id", playlistName: "4★" }],
    );

    expect(result).toMatchObject({ relinkedCount: 1, unresolvedCount: 0 });
    expect(result.playlists[0]).toMatchObject({
      playlistId: "current-4-star-id",
      playlistName: "4★",
      isActive: true,
      lastSyncAt: 0,
      smartPlaylistTrackUris: [],
    });
  });

  it("keeps an unresolved definition but disables it instead of deleting it", () => {
    const result = prepareSmartPlaylistImport([importedPlaylist()], []);

    expect(result).toMatchObject({ relinkedCount: 0, unresolvedCount: 1 });
    expect(result.playlists).toHaveLength(1);
    expect(result.playlists[0]).toMatchObject({
      playlistId: "",
      isActive: false,
      smartPlaylistTrackUris: [],
    });
  });

  it("does not guess when multiple current playlists share the imported name", () => {
    const result = prepareSmartPlaylistImport(
      [importedPlaylist()],
      [
        { playlistId: "first", playlistName: "4★" },
        { playlistId: "second", playlistName: "4★" },
      ],
    );

    expect(result.unresolvedCount).toBe(1);
    expect(result.playlists[0].playlistId).toBe("");
    expect(result.playlists[0].isActive).toBe(false);
  });

  it("preserves an exact current ID while clearing device-local membership", () => {
    const result = prepareSmartPlaylistImport(
      [importedPlaylist({ playlistId: "current", playlistName: "Old name" })],
      [{ playlistId: "current", playlistName: "Current name" }],
    );

    expect(result.relinkedCount).toBe(0);
    expect(result.playlists[0]).toMatchObject({
      playlistId: "current",
      playlistName: "Current name",
      lastSyncAt: 0,
      smartPlaylistTrackUris: [],
    });
  });
});

describe("mergeImportedSmartPlaylists", () => {
  const playlist = (overrides: Partial<SmartPlaylistCriteria>): SmartPlaylistCriteria => ({
    playlistId: "", playlistName: "Playlist", isActive: false, createdAt: 1, lastSyncAt: 0, smartPlaylistTrackUris: [],
    criteria: { includeTagClauses: [], clauseConnectors: [], ratingFilters: [], energyMinFilter: null, energyMaxFilter: null, bpmMinFilter: null, bpmMaxFilter: null },
    ...overrides,
  });

  it("keeps existing Smart Playlists that a file does not mention", () => {
    const kept = playlist({ id: "keep", playlistName: "Keep me" });
    const replaced = playlist({ id: "same", playlistName: "Old rule" });
    const unbound = playlist({ playlistName: "Unbound" });
    const merged = mergeImportedSmartPlaylists(
      [kept, replaced, unbound],
      [playlist({ id: "same", playlistName: "New rule" }), playlist({ playlistId: "37i9dQZF1DXcBWIGoYBM5M", playlistName: "Added" })],
    );
    expect(merged.map((item) => item.playlistName)).toEqual(["Keep me", "Unbound", "New rule", "Added"]);
  });
});


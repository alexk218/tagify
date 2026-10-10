import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlaylistDetails } from "@/features/playlist-state";
import { ArtistDetails } from "@/features/artist-state";
import { defaultTagData } from "@/constants/defaultTagData";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { emptyPrivateNote, mergeRemotePrivateNotes, savePrivateNote } from "@/services/sync/PrivateNotes";
import { spotifyApiService } from "@/services/SpotifyApiService";

const entityData = { name: "Example music", rating: 4, energy: 7, tagIds: [], dateModified: 50 };
function details(uri: string) {
  const shared = { taxonomy: defaultTagData.taxonomy, activeTagFilters: [], excludedTagFilters: [], onSetRating: vi.fn(), onSetEnergy: vi.fn(), onAddTag: vi.fn(), onRemoveTag: vi.fn(), onToggleTagIncludeOff: vi.fn() };
  return uri.startsWith("spotify:artist:") ? <ArtistDetails artistUri={uri} artistData={entityData} {...shared} onOpenArtist={vi.fn()} onRefreshMetadata={vi.fn()} /> :
    <PlaylistDetails playlistUri={uri} playlistData={{ ...entityData, trackCount: 1 }} tracks={{}} {...shared} onOpenPlaylist={vi.fn()} onRefreshMetadata={vi.fn()} onLoadTrackUris={vi.fn().mockResolvedValue([])} onApplyTrackUpdates={vi.fn().mockResolvedValue(undefined)} onTagTrack={vi.fn()} onSetTrackRating={vi.fn()} />;
}

beforeEach(async () => {
  indexedDBStorage.resetConnection();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
  vi.spyOn(spotifyApiService, "getAlbumTracks").mockResolvedValue([]);
  await indexedDBStorage.init();
});
afterEach(() => { vi.restoreAllMocks(); indexedDBStorage.resetConnection(); localStorage.clear(); vi.unstubAllGlobals(); });

it.each(["album", "playlist", "artist"])("integrates %s notes into the detail card, retains existing drafts, and saves without changing entity dates", async kind => {
  const uri = `spotify:${kind}:${"a".repeat(22)}`;
  if (kind === "artist") await indexedDBStorage.saveArtist(uri, entityData);
  else await indexedDBStorage.savePlaylist(uri, entityData);
  await savePrivateNote(uri, "Already saved", "");
  localStorage.setItem(`tagify:private-note-draft:tagify-db:${uri}`, JSON.stringify({ text: "Draft from the old panel", baseText: "Already saved" }));
  const view = render(details(uri));
  const field = screen.getByRole("textbox", { name: "Private note", exact: true });
  await waitFor(() => expect(field).toBeEnabled());
  expect(field).toHaveValue("Draft from the old panel");
  expect(field.closest("section")).not.toBeNull();
  expect(view.container.querySelector("details")).toBeNull();
  expect(screen.queryByRole("button", { name: "Save note" })).not.toBeInTheDocument();
  fireEvent.blur(field);
  await waitFor(async () => expect((await indexedDBStorage.getPrivateNote(uri))!.text).toBe("Draft from the old panel"));
  const saved = kind === "artist" ? await indexedDBStorage.getArtist(uri) : await indexedDBStorage.getPlaylist(uri);
  expect(saved!.dateModified).toBe(50);

  const other = `spotify:${kind}:${"b".repeat(22)}`;
  view.rerender(details(other));
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Private note", exact: true })).toBeEnabled());
  expect(screen.getByRole("textbox", { name: "Private note", exact: true })).toHaveValue("");
  view.rerender(details(uri));
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Private note", exact: true })).toHaveValue("Draft from the old panel"));
});

it("keeps a failed entity-note draft and exposes another device's saved copy before replacement", async () => {
  const uri = `spotify:playlist:${"c".repeat(22)}`;
  render(details(uri));
  const field = screen.getByRole("textbox", { name: "Private note", exact: true });
  await waitFor(() => expect(field).toBeEnabled());
  vi.spyOn(indexedDBStorage, "mutatePrivateNotes").mockRejectedValueOnce(new Error("Your note couldn't be saved. Please try again."));
  fireEvent.change(field, { target: { value: "Keep this draft" } });
  fireEvent.blur(field);
  expect(await screen.findByRole("alert")).toHaveTextContent("couldn't be saved");
  expect(field).toHaveValue("Keep this draft");
  await waitFor(() => expect(screen.getByRole("button", { name: "Save note" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  await waitFor(async () => expect((await indexedDBStorage.getPrivateNote(uri))!.text).toBe("Keep this draft"));
  await mergeRemotePrivateNotes([{ ...emptyPrivateNote(uri), text: "Other device's note", revision: 1 }]);
  await waitFor(() => expect(screen.getByLabelText("Other saved note")).toHaveValue("Other device's note"));
  expect(field).toHaveValue("Keep this draft");
});

import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { mergeTaxonomy } from "./tagData.taxonomyMerge";
import { rebaseRecord } from "./tagData.rebase";
import { isArtistEmpty, isPlaylistEmpty, isTrackEmpty } from "./tagData.helpers";
import {
  ArtistData,
  PlaylistData,
  TagDataStructure,
  TagTaxonomy,
  TrackData,
} from "@/types/tagData";

/**
 * The saved record after this page removed it. Removing clears what the page
 * knew about; anything added elsewhere in the meantime (a tag from another
 * device, a rating from Spotify's views) is kept, and the record stays.
 */
function removedRecord<T extends TrackData | PlaylistData | ArtistData>(
  before: T | undefined,
  current: T | null,
  isEmpty: (record: T) => boolean,
): T | null | undefined {
  if (!current) return undefined;
  if (!before) return null;
  const cleared = { ...before, rating: 0, energy: 0, tagIds: [] } as T;
  const kept = rebaseRecord(before, cleared, current);
  return !kept || isEmpty(kept) ? null : kept;
}

export async function persistTagDataDiff(
  previouslyPersisted: TagDataStructure | null,
  dataToSave: TagDataStructure,
): Promise<boolean> {
  if (!previouslyPersisted) {
    // An early UI save must never replace the whole database. Smart Playlist
    // rules can have changed independently of this React snapshot.
    console.error("Tagify: Library changes arrived before the saved library was loaded");
    return false;
  }

  let saved = true;
  const taxonomyChanged = previouslyPersisted.taxonomy !== dataToSave.taxonomy;

  const tracksToUpsert = new Map<string, TrackData>();
  const tracksToDelete: string[] = [];
  const playlistsToUpsert = new Map<string, PlaylistData>();
  const playlistsToDelete: string[] = [];
  const artistsToUpsert = new Map<string, ArtistData>();
  const artistsToDelete: string[] = [];

  const prevTracks = previouslyPersisted.tracks;
  const nextTracks = dataToSave.tracks;

  for (const [uri, nextTrack] of Object.entries(nextTracks)) {
    if (prevTracks[uri] !== nextTrack) {
      tracksToUpsert.set(uri, nextTrack);
    }
  }

  for (const uri of Object.keys(prevTracks)) {
    if (!(uri in nextTracks)) {
      tracksToDelete.push(uri);
    }
  }

  const prevPlaylists = previouslyPersisted.playlists || {};
  const nextPlaylists = dataToSave.playlists || {};

  for (const [uri, nextPlaylist] of Object.entries(nextPlaylists)) {
    if (prevPlaylists[uri] !== nextPlaylist) {
      playlistsToUpsert.set(uri, nextPlaylist);
    }
  }

  for (const uri of Object.keys(prevPlaylists)) {
    if (!(uri in nextPlaylists)) {
      playlistsToDelete.push(uri);
    }
  }

  const prevArtists = previouslyPersisted.artists || {};
  const nextArtists = dataToSave.artists || {};

  for (const [uri, nextArtist] of Object.entries(nextArtists)) {
    if (prevArtists[uri] !== nextArtist) {
      artistsToUpsert.set(uri, nextArtist);
    }
  }

  for (const uri of Object.keys(prevArtists)) {
    if (!(uri in nextArtists)) {
      artistsToDelete.push(uri);
    }
  }

  if (taxonomyChanged) {
    // Apply only this page's tag changes to the saved tags, so tags created
    // elsewhere (the extension, another device) since the last save are kept.
    const before = previouslyPersisted.taxonomy;
    const isEmpty = (taxonomy: TagTaxonomy) => !taxonomy.categoryOrder.length && !Object.keys(taxonomy.tagsById).length;
    saved = (await indexedDBStorage.saveTaxonomy((current) =>
      // A database still holding only the older tag format reads as empty here.
      mergeTaxonomy(before, dataToSave.taxonomy, isEmpty(current) && !isEmpty(before) ? before : current))) && saved;
  }

  if (tracksToUpsert.size > 0) {
    saved = (await indexedDBStorage.saveTracks(tracksToUpsert, prevTracks)) && saved;
  }

  if (tracksToDelete.length > 0) {
    try {
      await indexedDBStorage.patchTracks(Object.fromEntries(tracksToDelete.map((uri) => [
        uri, (current: TrackData | null) => removedRecord(prevTracks[uri], current, isTrackEmpty),
      ])));
    } catch (error) {
      console.error("Tagify: Removed songs could not be saved", error);
      saved = false;
    }
  }

  if (playlistsToUpsert.size > 0) {
    saved = (await indexedDBStorage.savePlaylists(playlistsToUpsert, prevPlaylists)) && saved;
  }

  if (playlistsToDelete.length > 0) {
    try {
      await indexedDBStorage.patchEntities<PlaylistData>("playlist", Object.fromEntries(playlistsToDelete.map((uri) => [
        uri, (current: PlaylistData | null) => removedRecord(prevPlaylists[uri], current, isPlaylistEmpty),
      ])));
    } catch (error) {
      console.error("Tagify: Removed playlists could not be saved", error);
      saved = false;
    }
  }

  if (artistsToUpsert.size > 0) {
    saved = (await indexedDBStorage.saveArtists(artistsToUpsert, prevArtists)) && saved;
  }

  if (artistsToDelete.length > 0) {
    try {
      await indexedDBStorage.patchEntities<ArtistData>("artist", Object.fromEntries(artistsToDelete.map((uri) => [
        uri, (current: ArtistData | null) => removedRecord(prevArtists[uri], current, isArtistEmpty),
      ])));
    } catch (error) {
      console.error("Tagify: Removed artists could not be saved", error);
      saved = false;
    }
  }

  return saved;
}

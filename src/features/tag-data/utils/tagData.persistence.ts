import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import {
  ArtistData,
  PlaylistData,
  TagDataStructure,
  TrackData,
} from "@/types/tagData";

export async function persistTagDataDiff(
  previouslyPersisted: TagDataStructure | null,
  dataToSave: TagDataStructure,
): Promise<boolean> {
  if (!previouslyPersisted) {
    // Safety net for unexpected startup ordering: fall back to full save once.
    return indexedDBStorage.saveAll(dataToSave);
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
    saved = (await indexedDBStorage.saveTaxonomy(dataToSave.taxonomy)) && saved;
  }

  if (tracksToUpsert.size > 0) {
    saved = (await indexedDBStorage.saveTracks(tracksToUpsert)) && saved;
  }

  if (tracksToDelete.length > 0) {
    const deleteResults = await Promise.all(
      tracksToDelete.map((uri) => indexedDBStorage.deleteTrack(uri)),
    );
    saved = deleteResults.every(Boolean) && saved;
  }

  if (playlistsToUpsert.size > 0) {
    saved = (await indexedDBStorage.savePlaylists(playlistsToUpsert)) && saved;
  }

  if (playlistsToDelete.length > 0) {
    const deleteResults = await Promise.all(
      playlistsToDelete.map((uri) => indexedDBStorage.deletePlaylist(uri)),
    );
    saved = deleteResults.every(Boolean) && saved;
  }

  if (artistsToUpsert.size > 0) {
    saved = (await indexedDBStorage.saveArtists(artistsToUpsert)) && saved;
  }

  if (artistsToDelete.length > 0) {
    const deleteResults = await Promise.all(
      artistsToDelete.map((uri) => indexedDBStorage.deleteArtist(uri)),
    );
    saved = deleteResults.every(Boolean) && saved;
  }

  return saved;
}

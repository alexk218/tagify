import { storageService } from "@/services/storage/StorageService";
import type { SongNameSources } from "./CommunitySongNames";

/** Tagify's own saved library as the source of names and artwork: no Spotify request of any kind. */
export function communitySongNameSources(): SongNameSources {
  return {
    async savedSongs(uris) {
      const tracks = await storageService.getTracks(uris);
      return new Map([...tracks].map(([uri, track]) => [uri, {
        name: track.name, imageUrl: track.albumImageUrl, albumUri: track.albumUri, albumName: track.albumName,
      }] as const));
    },
    async savedAlbum(uri) {
      const album = await storageService.getPlaylist(uri);
      return album ? { name: album.name, imageUrl: album.imageUrl } : null;
    },
    async savedArtist(uri) {
      const artist = await storageService.getArtist(uri);
      return artist ? { name: artist.name, imageUrl: artist.imageUrl } : null;
    },
  };
}

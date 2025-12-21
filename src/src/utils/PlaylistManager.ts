import { getPlaylistsContainingTrack } from "./PlaylistCache";

export function findPlaylistsContainingTrack(
  trackUri: string
): Array<{ id: string; name: string; owner: string }> {
  return getPlaylistsContainingTrack(trackUri);
}

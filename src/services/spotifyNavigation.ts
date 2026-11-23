import { spotifyService } from "@/services/SpotifyService";

/** Opens a song's own page in Spotify. Local files have none, so they open Local Files. */
export function openSpotifyTrack(trackUri: string): void {
  if (trackUri.startsWith("spotify:local:")) {
    Spicetify.Platform.History.push("/collection/local-files");
    return;
  }
  const id = trackUri.startsWith("spotify:track:") ? trackUri.split(":").pop() : null;
  if (id) Spicetify.Platform.History.push(`/track/${id}`);
}

/** Opens the artist page for one of a song's artists, found by name; searches for them when Spotify doesn't say. */
export async function openSpotifyArtist(artistName: string, trackUri: string): Promise<void> {
  try {
    if (trackUri.startsWith("spotify:local:")) {
      Spicetify.showNotification("Cannot navigate to artist for local files", true);
      return;
    }
    const artists = await spotifyService.getTrackArtists(trackUri);
    const artistId = artists.find((artist) => artist.name === artistName)?.uri?.split(":").pop();
    if (artistId) {
      Spicetify.Platform.History.push(`/artist/${artistId}`);
      return;
    }
    Spicetify.Platform.History.push(`/search/${encodeURIComponent(artistName)}/artists`);
  } catch (error) {
    console.error("Error navigating to artist:", error);
  }
}

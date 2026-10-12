/** Context URI for lists Tagify asks Spotify to play; Spotify plays the given pages in order. */
const LIST_CONTEXT_URI = "spotify:app:tagify";
/** Large lists are split into pages, the way Spotify pages its own playlists. */
const LIST_PAGE_SIZE = 500;

class TrackService {
  playTrack = async (uri: string): Promise<void> => {
    try {
      // Spotify can't open a local file on its own, but it plays one inside a list.
      if (uri.startsWith("spotify:local:")) await this.playList([uri]);
      else await Spicetify.Player.playUri(uri);
    } catch (err) {
      console.error("Error in playTrack:", err);
      Spicetify.showNotification("Spotify couldn't play this track. Try again in a moment.", true);
    }
  };

  /**
   * Plays a collection of track URIs in order, local files included.
   */
  playAllFilteredTracks = async (trackUris: string[]): Promise<void> => {
    if (trackUris.length === 0) {
      Spicetify.showNotification("No playable tracks match the filters", true);
      return;
    }
    try {
      await this.playList(trackUris);
      Spicetify.showNotification(`Playing ${trackUris.length} ${trackUris.length === 1 ? "track" : "tracks"}`);
    } catch (error) {
      console.error("Error playing tracks:", error);
      Spicetify.showNotification("Spotify couldn't start these tracks. Try again in a moment.", true);
    }
  };

  /**
   * Hands Spotify the whole list as one playback context. Unlike playing the first track and
   * queueing the rest, this starts immediately, keeps the order and works with local files.
   */
  private playList = async (trackUris: string[]): Promise<void> => {
    const player = Spicetify.Platform?.PlayerAPI as { play?: (context: unknown, options: unknown, playOptions: unknown) => Promise<unknown> } | undefined;
    if (typeof player?.play !== "function") throw new Error("Spotify's player isn't available");
    const pages = [];
    for (let start = 0; start < trackUris.length; start += LIST_PAGE_SIZE) {
      pages.push({ items: trackUris.slice(start, start + LIST_PAGE_SIZE).map((uri) => ({ uri })) });
    }
    await player.play({ uri: LIST_CONTEXT_URI, pages }, { featureIdentifier: "tagify" }, {});
  };
}

export const trackService = new TrackService();

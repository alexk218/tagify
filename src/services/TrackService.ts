class TrackService {
  playTrack = async (uri: string): Promise<void> => {
    try {
      // Cannot play local files directly. Can only add them to queue
      if (uri.startsWith("spotify:local:")) {
        if (!this.isActuallyPlaying()) {
          // cannot add track to queue when no tracks playing and queue empty. play dummy Spotify track first.
          const dummyUri = await this.getDummyTrackUri();
          Spicetify.Player.playUri(dummyUri);
          await new Promise((resolve) => setTimeout(resolve, 300));
        }

        const trackObject = [{ uri }];
        await Spicetify.addToQueue(trackObject);

        // wait for queue to update, then skip
        await new Promise((resolve) => setTimeout(resolve, 300));
        Spicetify.Player.next();
      } else {
        // direct playback for Spotify tracks
        Spicetify.Player.playUri(uri);
      }
    } catch (err) {
      console.error("Error in playTrack:", err);
    }
  };

  // Spicetify.Player.isPlaying() is not accurate. Needs more thorough checking
  private isActuallyPlaying = () => {
    const playerData = Spicetify.Player.data;
    const isPlaying = Spicetify.Player.isPlaying();
    const hasTrack = playerData?.item?.uri;
    const isPaused = playerData?.isPaused;

    // Only consider it playing if we have a track - player says it's playing - and it's not paused
    return isPlaying && hasTrack && !isPaused;
  };

  /**
   * Plays a collection of track URIs, handling mixed collections with local files
   */
  playAllFilteredTracks = async (trackUris: string[]): Promise<void> => {
    if (trackUris.length === 0) {
      Spicetify.showNotification("No playable tracks match the filters", true);
      return;
    }

    const spotifyTrackUris: string[] = trackUris.filter(
      (uri) => !uri.startsWith("spotify:local:"),
    );
    const isMixedTrackCollection: boolean = trackUris.some((uri) =>
      uri.startsWith("spotify:local:"),
    );
    if (isMixedTrackCollection) {
      await this.playMixedTrackCollection(trackUris, spotifyTrackUris);
    } else {
      await this.playSpotifyOnlyCollection(spotifyTrackUris);
    }
  };

  /**
   * When filtered tracks are only Spotify tracks (no Local Files) - simple approach
   */
  private playSpotifyOnlyCollection = async (
    spotifyTrackUris: string[],
  ): Promise<void> => {
    try {
      await Spicetify.Player.playUri(spotifyTrackUris[0]);

      const remainingTracks = [...spotifyTrackUris.slice(1)];
      const tracksToQueue = remainingTracks.map((uri) => ({ uri }));

      await Spicetify.addToQueue(tracksToQueue);
      Spicetify.showNotification(`Playing ${spotifyTrackUris.length} tracks`);
    } catch (error) {
      console.error("Error playing tracks:", error);
      Spicetify.showNotification("Failed to start playback", true);
    }
  };

  /**
   * When filtered tracks (Play All) contains Local Files
   * Requires more complex approach (cannot play a Local File directly, must queue)
   */
  private playMixedTrackCollection = async (
    allTrackUris: string[],
    spotifyTrackUris: string[],
  ): Promise<void> => {
    try {
      // Get a dummy track URI (this will be played solely to clear the track queue)
      const dummyUri =
        spotifyTrackUris.length > 0
          ? spotifyTrackUris[0]
          : await this.getDummyTrackUri();

      await this.clearQueueWithDummyTrack(dummyUri);

      await this.queueAndStartPlayback(allTrackUris, dummyUri);

      Spicetify.showNotification(`Playing ${allTrackUris.length} tracks`);
    } catch (error) {
      console.error("Error playing tracks:", error);
      Spicetify.showNotification("Failed to start playback", true);
    }
  };

  private clearQueueWithDummyTrack = async (
    dummyUri: string,
  ): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await Spicetify.Player.playUri(dummyUri);

    await new Promise((resolve) => setTimeout(resolve, 300));
    await Spicetify.Player.playUri(dummyUri); // Play again to force clear

    await this.waitForSpecificTrack(dummyUri);
  };

  private queueAndStartPlayback = async (
    trackUris: string[],
    dummyUri: string,
  ): Promise<void> => {
    const tracksToQueue = trackUris.map((uri) => ({ uri }));
    await Spicetify.addToQueue(tracksToQueue);

    // Skip first track queue
    Spicetify.Player.next();
    await new Promise((resolve) => setTimeout(resolve, 200));

    const playerData: Spicetify.PlayerState = Spicetify.Player.data;

    const currentUri = playerData.item?.uri;
    if (currentUri === dummyUri) {
      Spicetify.Player.next();
    }
  };

  private getDummyTrackUri = async (): Promise<string> => {
    try {
      // Use LibraryAPI to get a track from liked songs
      const tracks = await (Spicetify.Platform.LibraryAPI as any).getTracks({
        limit: 1,
      });

      if (tracks?.items?.[0]?.uri) {
        return tracks.items[0].uri;
      }

      // Fallback - Never Gonna Give You Up - Rick Astley
      return "spotify:track:4iV5W9uYEdYUVa79Axb7Rh";
    } catch (error) {
      console.error("Error getting dummy track:", error);
      return "spotify:track:4iV5W9uYEdYUVa79Axb7Rh";
    }
  };

  private waitForSpecificTrack = (expectedUri: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const maxAttempts = 30; // 3 seconds max wait
      let attempts = 0;
      const checkPlayback = () => {
        attempts++;
        // Check if we're playing and get the current track
        if (Spicetify.Player.isPlaying() && Spicetify.Player.data) {
          const playerData: Spicetify.PlayerState = Spicetify.Player.data;
          const currentUri = playerData.item?.uri;
          if (currentUri === expectedUri) {
            resolve();
            return;
          }
        }
        // Timeout after max attempts
        if (attempts >= maxAttempts) {
          reject(new Error(`Timeout waiting for track ${expectedUri} to play`));
          return;
        }
        setTimeout(checkPlayback, 100);
      };
      checkPlayback();
    });
  };
}

export const trackService = new TrackService();

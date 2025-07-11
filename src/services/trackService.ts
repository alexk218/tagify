import { TagDataStructure } from "../hooks/useTagData";

class TrackService {
  playTrackViaQueue = (uri: string): Promise<boolean> => {
    return new Promise((resolve) => {
      try {
        // Special handling for local files
        if (uri.startsWith("spotify:local:")) {
          // Format for queue API
          const trackObject = [{ uri }];

          // Check if Player is currently playing music
          const isPlaying = Spicetify.Player.isPlaying();

          if (isPlaying) {
            // Add track to queue and skip to it
            Spicetify.addToQueue(trackObject)
              .then(() => {
                // Need to wait a moment for queue to update
                setTimeout(() => {
                  Spicetify.Player.next();
                  resolve(true);
                }, 300);
              })
              .catch((err) => {
                console.error("Failed to add local file to queue:", err);
                // Navigate to Local Files as fallback
                Spicetify.Platform.History.push("/collection/local-files");
                Spicetify.showNotification(
                  "Local files must be played from Local Files section",
                  true
                );
                resolve(false);
              });
          } else {
            // If nothing is playing, try direct playback first
            Spicetify.Player.playUri(uri)
              .then(() => {
                resolve(true);
              })
              .catch((err) => {
                console.error("Failed to play local file directly:", err);
                // Navigate to Local Files as fallback
                Spicetify.Platform.History.push("/collection/local-files");
                Spicetify.showNotification(
                  "Local files must be played from Local Files section",
                  true
                );
                resolve(false);
              });
          }
        } else {
          // Regular Spotify track handling
          const isPlaying = Spicetify.Player.isPlaying();

          if (isPlaying) {
            try {
              // Add track to top of queue
              const trackObject = [{ uri }];

              // Queue access approach that should work
              const queue = Spicetify.Queue;

              if (queue && queue.nextTracks && queue.nextTracks.length > 0) {
                // Queue has tracks, try to insert our track at the beginning
                Spicetify.addToQueue(trackObject)
                  .then(() => {
                    // After adding to queue, play next
                    Spicetify.Player.next();
                    resolve(true);
                  })
                  .catch((err) => {
                    console.error("Failed to add to queue", err);
                    Spicetify.showNotification("Unable to play track, playing directly", true);

                    // Fallback to direct play
                    Spicetify.Player.playUri(uri)
                      .then(() => resolve(true))
                      .catch((playErr) => {
                        console.error("Failed to play directly:", playErr);
                        resolve(false);
                      });
                  });
              } else {
                // Queue is empty, simply add to queue and skip
                Spicetify.addToQueue(trackObject)
                  .then(() => {
                    Spicetify.Player.next();
                    resolve(true);
                  })
                  .catch((err) => {
                    console.error("Failed to add to queue", err);
                    Spicetify.showNotification("Unable to play track, playing directly", true);

                    // Fallback to direct play
                    Spicetify.Player.playUri(uri)
                      .then(() => resolve(true))
                      .catch((playErr) => {
                        console.error("Failed to play directly:", playErr);
                        resolve(false);
                      });
                  });
              }
            } catch (error) {
              console.error("Error manipulating queue:", error);

              // Fallback to direct play
              Spicetify.Player.playUri(uri)
                .then(() => resolve(true))
                .catch((playErr) => {
                  console.error("Failed to play directly:", playErr);
                  resolve(false);
                });
            }
          } else {
            // No music playing, just play the track directly
            Spicetify.Player.playUri(uri)
              .then(() => resolve(true))
              .catch((err) => {
                console.error("Failed to play track:", err);
                resolve(false);
              });
          }
        }
      } catch (error) {
        console.error("Error in playTrackViaQueue:", error);
        resolve(false);
      }
    });
  };

  getLegacyFormatTracksFromTagData = (tagData: TagDataStructure) => {
    const result: {
      [uri: string]: {
        rating: number;
        energy: number;
        bpm: number | null;
        tags: { tag: string; category: string }[];
      };
    } = {};

    try {
      // First check if we have valid tagData
      if (!tagData || typeof tagData !== "object") {
        console.error("TagData is invalid", tagData);
        return {};
      }

      // Check if categories exist and is an array
      if (!tagData.categories || !Array.isArray(tagData.categories)) {
        console.error("TagData is missing valid categories array", tagData.categories);
        return {};
      }

      // Check if tracks exist
      if (!tagData.tracks || typeof tagData.tracks !== "object") {
        console.error("TagData is missing valid tracks object", tagData.tracks);
        return {};
      }

      // Process each track
      Object.entries(tagData.tracks).forEach(([uri, track]) => {
        // Skip invalid tracks
        if (!track) return;

        // Skip tracks that have no meaningful data
        if (track.rating === 0 && track.energy === 0 && (!track.tags || track.tags.length === 0)) {
          return;
        }

        // Create entry for this track
        result[uri] = {
          rating: track.rating || 0,
          energy: track.energy || 0,
          bpm: track.bpm || null,
          tags: [],
        };

        // Skip if no tags
        if (!track.tags || !Array.isArray(track.tags) || track.tags.length === 0) {
          return;
        }

        // Process each tag
        track.tags.forEach((tag) => {
          // Find the tag info
          const category = tagData.categories.find((c) => c.id === tag.categoryId);
          if (!category) return;

          const subcategory = category.subcategories.find((s) => s.id === tag.subcategoryId);
          if (!subcategory) return;

          const tagObj = subcategory.tags.find((t) => t.id === tag.tagId);
          if (!tagObj) return;

          // Add the tag with proper names
          result[uri].tags.push({
            tag: tagObj.name,
            category: `${category.name} > ${subcategory.name}`,
          });
        });
      });

      return result;
    } catch (error) {
      console.error("Error formatting track data:", error);
      return {}; // Return empty object on error
    }
  };
}

export const trackService = new TrackService();

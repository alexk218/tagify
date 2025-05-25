import React from "react";
import styles from "./MultiTrackDetails.module.css";
import { TagCategory, TrackTag } from "../hooks/useTagData";

interface MultiTrackDetailsProps {
  tracks: Array<{
    uri: string;
    name: string;
    artists: { name: string }[];
    album: { name: string };
  }>;
  trackTagsMap: Record<string, TrackTag[]>;
  categories: TagCategory[];
  onTagAllTracks: (categoryId: string, subcategoryId: string, tagId: string) => void;
  onTagSingleTrack?: (
    trackUri: string,
    categoryId: string,
    subcategoryId: string,
    tagId: string
  ) => void;
  onCancelTagging: () => void;
  onPlayTrack?: (uri: string) => void;
  lockedTrackUri?: string | null;
  onLockTrack?: (uri: string | null) => void;
}

const MultiTrackDetails: React.FC<MultiTrackDetailsProps> = ({
  tracks,
  trackTagsMap,
  categories,
  onTagAllTracks,
  onTagSingleTrack,
  onCancelTagging,
  onPlayTrack,
  lockedTrackUri,
  onLockTrack,
}) => {
  // Helper function to get tag name
  const getTagName = (categoryId: string, subcategoryId: string, tagId: string) => {
    const category = categories.find((c) => c.id === categoryId);
    if (!category) return "Unknown";

    const subcategory = category.subcategories.find((s) => s.id === subcategoryId);
    if (!subcategory) return "Unknown";

    const tag = subcategory.tags.find((t) => t.id === tagId);
    return tag ? tag.name : "Unknown";
  };

  // Find common tags across all tracks
  const findCommonTags = () => {
    if (tracks.length === 0) return [];

    // Start with the tags from the first track
    const firstTrackUri = tracks[0].uri;
    const firstTrackTags = trackTagsMap[firstTrackUri] || [];

    if (tracks.length === 1) return firstTrackTags;

    // Check which tags exist in all tracks
    return firstTrackTags.filter((tag) => {
      return tracks.every((track) => {
        const trackTags = trackTagsMap[track.uri] || [];
        return trackTags.some(
          (t) =>
            t.categoryId === tag.categoryId &&
            t.subcategoryId === tag.subcategoryId &&
            t.tagId === tag.tagId
        );
      });
    });
  };

  const commonTags = findCommonTags();

  const handleRemoveTag = (tag: TrackTag) => {
    if (lockedTrackUri && onTagSingleTrack) {
      onTagSingleTrack(lockedTrackUri, tag.categoryId, tag.subcategoryId, tag.tagId);
    } else {
      onTagAllTracks(tag.categoryId, tag.subcategoryId, tag.tagId);
    }
  };

  const handleTrackClick = (uri: string, e: React.MouseEvent) => {
    // Don't trigger when clicking on play button or tags
    if (
      (e.target as HTMLElement).closest(`.${styles.playButton}`) ||
      (e.target as HTMLElement).closest(`.${styles.tagItem}`)
    ) {
      return;
    }

    if (onLockTrack) {
      // If already locked on this track, unlock it
      if (lockedTrackUri === uri) {
        onLockTrack(null);
      } else {
        onLockTrack(uri);
      }
    }
  };

  const handleTagClick = (trackUri: string, tag: TrackTag, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent track locking when clicking on tags

    if (onTagSingleTrack) {
      // Always apply to the specific track that owns the tag
      onTagSingleTrack(trackUri, tag.categoryId, tag.subcategoryId, tag.tagId);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.title}>Mass Tagging</h2>
        <div className={styles.summary}>
          <span className={styles.trackCount}>{tracks.length} tracks selected</span>
          {lockedTrackUri && (
            <button
              className={styles.unlockButton}
              onClick={() => onLockTrack && onLockTrack(null)}
              title="Unlock to apply tags to all tracks"
            >
              🔓 Unlock
            </button>
          )}
          <button className={styles.cancelButton} onClick={onCancelTagging}>
            Cancel Mass Tagging
          </button>
        </div>
      </div>

      {lockedTrackUri ? (
        <div className={styles.lockingBanner}>
          <span className={styles.lockingIcon}>🔒</span>
          <span className={styles.lockingText}>
            Tags will be applied to the locked track only. Click the track again or the "Unlock"
            button to revert to mass tagging.
          </span>
        </div>
      ) : (
        <div className={styles.multiTaggingBanner}>
          <span className={styles.multiTaggingIcon}>🏷️</span>
          <span className={styles.multiTaggingText}>
            Tags will be applied to all selected tracks. Click on a track to lock tagging to that
            track only.
          </span>
        </div>
      )}

      <div className={styles.commonTagsSection}>
        <h3 className={styles.sectionTitle}>Common Tags</h3>
        {commonTags.length > 0 ? (
          <div className={styles.tagList}>
            {commonTags.map((tag, index) => (
              <div
                key={index}
                className={styles.tagItem}
                onClick={() => handleRemoveTag(tag)}
                title="Click to toggle this tag"
              >
                {getTagName(tag.categoryId, tag.subcategoryId, tag.tagId)}
                <span className={styles.removeTagIcon}>×</span>
              </div>
            ))}
          </div>
        ) : (
          <p className={styles.noTags}>No common tags</p>
        )}
      </div>

      <div className={styles.trackListContainer}>
        <h3 className={styles.sectionTitle}>Selected Tracks</h3>
        <div className={styles.trackList}>
          {tracks.map((track) => (
            <div
              key={track.uri}
              className={`${styles.trackItem} ${
                lockedTrackUri === track.uri ? styles.lockedTrack : ""
              }`}
              onClick={(e) => handleTrackClick(track.uri, e)}
            >
              <div className={styles.trackInfo}>
                {lockedTrackUri === track.uri && <span className={styles.lockIcon}>🔒</span>}
                <span className={styles.trackName}>{track.name}</span>
                <span className={styles.trackArtist}>
                  {track.artists.map((artist) => artist.name).join(", ")}
                </span>
              </div>
              <div className={styles.trackTagsInline}>
                {(trackTagsMap[track.uri] || []).length > 0 ? (
                  <div className={styles.tagList}>
                    {trackTagsMap[track.uri].map((tag, index) => (
                      <div
                        key={index}
                        className={styles.tagItem}
                        onClick={(e) => handleTagClick(track.uri, tag, e)}
                        title="Click to toggle this tag on this track"
                      >
                        {getTagName(tag.categoryId, tag.subcategoryId, tag.tagId)}
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className={styles.noTags}>No tags</span>
                )}
              </div>
              <button
                className={styles.playButton}
                onClick={(e) => {
                  e.stopPropagation(); // Prevent event bubbling
                  if (onPlayTrack) onPlayTrack(track.uri);
                }}
                title={"Play this track"}
              >
                {"Play"}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.instructions}>
        <p>
          Apply tags to {lockedTrackUri ? "the locked track" : "all selected tracks"} using the tag
          selector below.
        </p>
        <p>
          {lockedTrackUri
            ? "Click the locked track again to unlock it."
            : "Click any track to lock tagging to that track only."}
        </p>
      </div>
    </div>
  );
};

export default MultiTrackDetails;

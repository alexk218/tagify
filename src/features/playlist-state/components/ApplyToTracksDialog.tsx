import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactStars from "react-rating-stars-component";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faStar, faStarHalf } from "@fortawesome/free-solid-svg-icons";
import { Portal } from "@/components/ui";
import type { BatchTagUpdate, BatchTrackAlbumDetails, TrackData } from "@/types/tagData";
import {
  buildPlaylistTrackApplyUpdates,
  previewPlaylistTrackApply,
  type PlaylistTrackApplyChoices,
  type PlaylistTrackApplyValues,
} from "../utils/playlistTrackApply";
import styles from "./ApplyToTracksDialog.module.css";

interface ApplyToTracksDialogProps {
  entityLabel: "Album" | "Playlist";
  name: string;
  ownerName: string | null;
  values: PlaylistTrackApplyValues;
  albumDetails?: BatchTrackAlbumDetails;
  tagNames: string[];
  tracks: Record<string, TrackData>;
  loadTrackUris: () => Promise<string[]>;
  onApply: (updates: BatchTagUpdate[]) => Promise<void>;
  onClose: () => void;
}

type LoadState = "loading" | "loaded" | "failed";

function pluralizeTracks(count: number): string {
  return `${count} ${count === 1 ? "track" : "tracks"}`;
}

const ApplyToTracksDialog: React.FC<ApplyToTracksDialogProps> = ({
  entityLabel,
  name,
  ownerName,
  values,
  albumDetails,
  tagNames,
  tracks,
  loadTrackUris,
  onApply,
  onClose,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [trackUris, setTrackUris] = useState<string[]>([]);
  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [choices, setChoices] = useState<PlaylistTrackApplyChoices>({
    tags: true,
    rating: true,
    energy: true,
  });
  const entityLabelLower = entityLabel.toLowerCase();
  const loadTrackUrisRef = useRef(loadTrackUris);
  const loadRequestRef = useRef(0);
  loadTrackUrisRef.current = loadTrackUris;

  const loadTracks = useCallback(async () => {
    const request = ++loadRequestRef.current;
    setLoadState("loading");
    try {
      const loadedTrackUris = await loadTrackUrisRef.current();
      if (request !== loadRequestRef.current) {
        return;
      }
      setTrackUris(Array.from(new Set(loadedTrackUris)));
      setLoadState(loadedTrackUris.length > 0 ? "loaded" : "failed");
    } catch {
      if (request === loadRequestRef.current) {
        setLoadState("failed");
      }
    }
  }, []);

  useEffect(() => {
    void loadTracks();
  }, [loadTracks]);

  // The dialog mounts through a portal, so focus it once its element exists.
  const attachDialog = useCallback((element: HTMLDivElement | null) => {
    dialogRef.current = element;
    element?.focus();
  }, []);

  const preview = useMemo(
    () => previewPlaylistTrackApply(trackUris, tracks, values),
    [trackUris, tracks, values],
  );
  const options = [
    values.tagIds.length > 0 ? ("tags" as const) : null,
    values.rating > 0 ? ("rating" as const) : null,
    values.energy > 0 ? ("energy" as const) : null,
  ].filter((option): option is keyof PlaylistTrackApplyChoices => option !== null);
  const changeCounts: Record<keyof PlaylistTrackApplyChoices, number> = {
    tags: preview.tagTrackCount,
    rating: preview.ratingTrackCount,
    energy: preview.energyTrackCount,
  };
  const effectiveChoices: PlaylistTrackApplyChoices = {
    tags: choices.tags && changeCounts.tags > 0,
    rating: choices.rating && changeCounts.rating > 0,
    energy: choices.energy && changeCounts.energy > 0,
  };
  const updates = buildPlaylistTrackApplyUpdates(
    trackUris,
    tracks,
    values,
    effectiveChoices,
    albumDetails,
  );
  const isLoaded = loadState === "loaded";

  const close = () => {
    if (!isApplying) {
      onClose();
    }
  };

  const apply = async () => {
    if (updates.length === 0) {
      return;
    }

    setIsApplying(true);
    setApplyError(null);
    try {
      await onApply(updates);
      Spicetify.showNotification(`Updated ${pluralizeTracks(updates.length)} from ${name}`);
      onClose();
    } catch {
      setApplyError("The tracks couldn't be updated. Please try again.");
      setIsApplying(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Keep Spotify and Tagify shortcuts from reacting while the dialog is open.
    event.stopPropagation();
    if (event.key === "Escape") {
      close();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }

    const controls = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled])",
      ) ?? [],
    );
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  const describeOption = (option: keyof PlaylistTrackApplyChoices): string => {
    const count = changeCounts[option];
    if (option === "tags") {
      if (count === 0) {
        return "Every track already has these tags.";
      }
      if (count === preview.trackCount) {
        return count === 1 ? "Added to its only track." : `Added to all ${count} tracks.`;
      }
      return `Added to the ${pluralizeTracks(count)} missing some of them.`;
    }
    if (option === "rating") {
      return count === 0
        ? "Every track already has its own rating."
        : `Rates the ${pluralizeTracks(count)} without a rating yet.`;
    }
    return count === 0
      ? "Every track already has its own energy."
      : `Sets energy on the ${pluralizeTracks(count)} without it yet.`;
  };

  return (
    <Portal>
      <div
        className={styles.overlay}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            close();
          }
        }}
      >
        <div
          className={styles.dialog}
          role="dialog"
          aria-modal="true"
          aria-labelledby="apply-to-tracks-title"
          aria-describedby="apply-to-tracks-description"
          tabIndex={-1}
          ref={attachDialog}
          onKeyDown={handleKeyDown}
        >
          <span className={styles.eyebrow}>Apply to tracks</span>
          <h2 id="apply-to-tracks-title" className={styles.title}>
            {name}
          </h2>
          <p className={styles.subtitle}>
            {[ownerName, isLoaded ? pluralizeTracks(preview.trackCount) : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p id="apply-to-tracks-description" className={styles.description}>
            Copy this {entityLabelLower}&apos;s own tags, rating, and energy to its
            tracks. Nothing already set on a track is removed or replaced.
          </p>

          {loadState === "loading" ? (
            <p className={styles.status} role="status">
              Finding the {entityLabelLower}&apos;s tracks…
            </p>
          ) : null}

          {loadState === "failed" ? (
            <div className={styles.status} role="alert">
              <p>
                Spotify didn&apos;t return this {entityLabelLower}&apos;s tracks. Check
                your connection and try again.
              </p>
              <button type="button" className={styles.retryButton} onClick={() => void loadTracks()}>
                Try again
              </button>
            </div>
          ) : null}

          {isLoaded ? (
            <fieldset className={styles.options} disabled={isApplying}>
              <legend className={styles.legend}>What to copy</legend>
              {options.map((option) => {
                const isAvailable = changeCounts[option] > 0;
                return (
                  <label
                    key={option}
                    className={`${styles.option} ${
                      effectiveChoices[option] ? styles.optionChecked : ""
                    } ${isAvailable ? "" : styles.optionUnavailable}`}
                  >
                    <input
                      type="checkbox"
                      checked={effectiveChoices[option]}
                      disabled={!isAvailable}
                      onChange={(event) =>
                        setChoices((current) => ({
                          ...current,
                          [option]: event.target.checked,
                        }))
                      }
                    />
                    <span className={styles.optionText}>
                      <span className={styles.optionTitle}>
                        {option === "tags" ? (
                          <>
                            {entityLabel} tags
                            <span className={styles.tagNames}>
                              {tagNames.map((tagName) => (
                                <span key={tagName} className={styles.tagName}>
                                  {tagName}
                                </span>
                              ))}
                            </span>
                          </>
                        ) : option === "rating" ? (
                          <>
                            {entityLabel} rating
                            <span className={styles.ratingStars} aria-label={`${values.rating} stars`}>
                              <ReactStars
                                count={5}
                                value={values.rating}
                                edit={false}
                                size={15}
                                isHalf={true}
                                emptyIcon={<FontAwesomeIcon icon={faStar} />}
                                halfIcon={<FontAwesomeIcon icon={faStarHalf} />}
                                fullIcon={<FontAwesomeIcon icon={faStar} />}
                                activeColor="#ffd700"
                                color="var(--spice-button-disabled)"
                              />
                            </span>
                          </>
                        ) : (
                          <>
                            {entityLabel} energy
                            <span className={styles.energyValue}>{values.energy}</span>
                          </>
                        )}
                      </span>
                      <span className={styles.optionDetail}>{describeOption(option)}</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          ) : null}

          {applyError ? (
            <p className={styles.error} role="alert">
              {applyError}
            </p>
          ) : null}

          <div className={styles.actions}>
            <button type="button" onClick={close} disabled={isApplying}>
              Cancel
            </button>
            <button
              type="button"
              className={styles.primary}
              onClick={() => void apply()}
              disabled={!isLoaded || updates.length === 0 || isApplying}
            >
              {isApplying
                ? "Updating…"
                : !isLoaded
                  ? "Update tracks"
                  : updates.length > 0
                    ? `Update ${pluralizeTracks(updates.length)}`
                    : "Nothing to update"}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
};

export default ApplyToTracksDialog;

import React, { useRef, useState } from "react";
import ReactStars from "react-rating-stars-component";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faStar, faStarHalf } from "@fortawesome/free-solid-svg-icons";
import { X } from "lucide-react";
import styles from "./AlbumTrackRating.module.css";

interface AlbumTrackRatingProps {
  trackName: string;
  rating: number;
  onRate: (rating: number) => void;
}

const MAX_RATING = 5;
const RATING_STEP = 0.5;
const KEY_STEPS: Record<string, number> = {
  ArrowRight: RATING_STEP,
  ArrowUp: RATING_STEP,
  ArrowLeft: -RATING_STEP,
  ArrowDown: -RATING_STEP,
};

function describeRating(rating: number): string {
  if (rating <= 0) {
    return "Not rated";
  }
  return `${rating} ${rating === 1 ? "star" : "stars"}`;
}

function getKeyboardRating(key: string, currentRating: number): number | null {
  if (key in KEY_STEPS) {
    return currentRating + KEY_STEPS[key];
  }
  if (key === "Home" || key === "Delete" || key === "Backspace") {
    return 0;
  }
  if (key === "End") {
    return MAX_RATING;
  }
  return /^[0-5]$/.test(key) ? Number(key) : null;
}

/** Editable stars for one track that keep keyboard focus while ratings save. */
const AlbumTrackRating: React.FC<AlbumTrackRatingProps> = ({ trackName, rating, onRate }) => {
  const sliderRef = useRef<HTMLSpanElement>(null);
  const [savedRating, setSavedRating] = useState(rating);
  const [shownRating, setShownRating] = useState(rating);
  // A rating saved elsewhere replaces whatever the stars show.
  if (rating !== savedRating) {
    setSavedRating(rating);
    setShownRating(rating);
  }

  const rate = (nextRating: number) => {
    const boundedRating = Math.min(MAX_RATING, Math.max(0, nextRating));
    if (boundedRating === shownRating) {
      return;
    }
    setShownRating(boundedRating);
    onRate(boundedRating);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    const nextRating = getKeyboardRating(event.key, shownRating);
    if (nextRating === null) {
      return;
    }
    event.preventDefault();
    rate(nextRating);
  };

  return (
    <>
      <span
        ref={sliderRef}
        role="slider"
        tabIndex={0}
        aria-label={`Rating for "${trackName}"`}
        aria-valuemin={0}
        aria-valuemax={MAX_RATING}
        aria-valuenow={shownRating}
        aria-valuetext={describeRating(shownRating)}
        className={`${styles.stars} ${shownRating > 0 ? "" : styles.starsUnrated}`}
        onKeyDown={handleKeyDown}
      >
        {/* The stars only read their value on mount, so they remount on change
            while this slider keeps focus. */}
        <span aria-hidden="true">
          <ReactStars
            key={shownRating}
            count={MAX_RATING}
            value={shownRating}
            onChange={rate}
            a11y={false}
            size={15}
            isHalf={true}
            emptyIcon={<FontAwesomeIcon icon={faStar} />}
            halfIcon={<FontAwesomeIcon icon={faStarHalf} />}
            fullIcon={<FontAwesomeIcon icon={faStar} />}
            activeColor="#ffd700"
            color="var(--spice-button-disabled)"
          />
        </span>
      </span>
      <span className={styles.clearSlot}>
        {shownRating > 0 ? (
          <button
            type="button"
            className={styles.clear}
            onClick={() => {
              rate(0);
              sliderRef.current?.focus();
            }}
            aria-label={`Clear rating for "${trackName}"`}
            title="Clear rating"
          >
            <X size={12} aria-hidden="true" />
          </button>
        ) : null}
      </span>
    </>
  );
};

export default AlbumTrackRating;

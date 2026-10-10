import React from "react";
import ReactStars from "react-rating-stars-component";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faStar, faStarHalf } from "@fortawesome/free-solid-svg-icons";
import { Star } from "lucide-react";
import type { CustomTagAccent, TagAccentId } from "@/types/tagData";
import { buildTagAccentCssVars } from "@/features/tag-data/utils/tagAccent";
import type { EntityKind, EntityMetaItem } from "./EntityDetailsCard";
import styles from "./EntityListRow.module.css";

export interface EntityRowTag {
  id: string;
  name: string;
  accentId: TagAccentId | null;
  title: string;
}

export interface EntityRowTrackTag {
  id: string;
  name: string;
  trackCount: number;
  title: string;
}

interface EntityListRowProps {
  kind: EntityKind;
  /** "Album", "Playlist", or "Artist". */
  entityLabel: string;
  name: string;
  imageUrl?: string | null;
  isActive: boolean;
  openTitle: string;
  onSelect: () => void;
  onOpen: () => void;
  meta: EntityMetaItem[];
  rating: number;
  energy: number;
  /** Tags added to the item itself. Each one toggles a list filter. */
  tags: EntityRowTag[];
  /** Tags common to the user's tracks, shown apart from the item's own tags. */
  trackTags: EntityRowTrackTag[];
  hiddenTrackTagCount?: number;
  /** Whether track tags filter this list; album filters only use the album's own tags. */
  canFilterByTrackTags: boolean;
  customAccentsById: Record<string, CustomTagAccent>;
  activeTagFilters: readonly string[];
  excludedTagFilters: readonly string[];
  onToggleTag: (tagId: string) => void;
  progressBar?: React.ReactNode;
  progressText?: string | null;
  progressTitle?: string;
  isProgressComplete?: boolean;
  average?: { text: string; title: string } | null;
  /** A short note, such as while tracks are still being checked. */
  status?: string | null;
}

const COVER_CLASSES: Record<EntityKind, string> = {
  album: styles.albumCover,
  playlist: styles.playlistCover,
  artist: styles.artistCover,
};

/**
 * One album, playlist, or artist in a list: identity and tags on the left,
 * the user's own scores and what their tracks say on the right.
 */
export function EntityListRow({
  kind,
  entityLabel,
  name,
  imageUrl,
  isActive,
  openTitle,
  onSelect,
  onOpen,
  meta,
  rating,
  energy,
  tags,
  trackTags,
  hiddenTrackTagCount = 0,
  canFilterByTrackTags,
  customAccentsById,
  activeTagFilters,
  excludedTagFilters,
  onToggleTag,
  progressBar,
  progressText,
  progressTitle,
  isProgressComplete = false,
  average,
  status,
}: EntityListRowProps) {
  const entityLabelLower = entityLabel.toLowerCase();
  const toggleTag = (event: React.MouseEvent, tagId: string) => {
    event.stopPropagation();
    onToggleTag(tagId);
  };
  const hasScores = rating > 0 || energy > 0;
  const hasProgress = Boolean(progressBar || progressText);

  return (
    <li className={`${styles.row} ${isActive ? styles.rowActive : ""}`} onClick={onSelect}>
      <button
        type="button"
        className={`${styles.cover} ${COVER_CLASSES[kind]}`}
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
        aria-label={`Show ${name} details`}
        aria-pressed={isActive}
      >
        {imageUrl ? (
          <img src={imageUrl} alt={`${name} cover`} className={styles.coverImage} />
        ) : (
          <span className={styles.coverPlaceholder} aria-hidden="true">♪</span>
        )}
      </button>

      <div className={styles.main}>
        <button
          type="button"
          className={styles.name}
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          title={openTitle}
        >
          {name}
        </button>

        {meta.length > 0 ? (
          <div className={styles.meta}>
            <span className={styles.metaItems}>
              {meta.map((item) => (
                <span key={item.key} title={item.title}>
                  {item.content}
                </span>
              ))}
            </span>
          </div>
        ) : null}

        {tags.length > 0 || trackTags.length > 0 ? (
          <div className={styles.tags}>
            {tags.map((tag) => (
              <button
                type="button"
                key={tag.id}
                className={`${styles.tag} ${tag.accentId ? styles.tagAccented : ""} ${
                  activeTagFilters.includes(tag.id) ? styles.tagActive : ""
                } ${excludedTagFilters.includes(tag.id) ? styles.tagExcluded : ""}`}
                style={buildTagAccentCssVars(tag.accentId, customAccentsById)}
                onClick={(event) => toggleTag(event, tag.id)}
                aria-label={tag.title}
                title={tag.title}
              >
                {tag.name}
              </button>
            ))}

            {trackTags.length > 0 ? (
              <span className={styles.trackTags} aria-label="Common tags on your tracks">
                <span className={styles.trackTagsLabel}>From tracks</span>
                {trackTags.map((tag) =>
                  canFilterByTrackTags ? (
                    <button
                      type="button"
                      key={tag.id}
                      className={`${styles.commonTag} ${styles.commonTagButton} ${
                        activeTagFilters.includes(tag.id) ? styles.commonTagActive : ""
                      } ${excludedTagFilters.includes(tag.id) ? styles.commonTagExcluded : ""}`}
                      aria-pressed={activeTagFilters.includes(tag.id)}
                      title={tag.title}
                      onClick={(event) => toggleTag(event, tag.id)}
                    >
                      {tag.name} <span className={styles.commonTagCount}>{tag.trackCount}</span>
                    </button>
                  ) : (
                    <span key={tag.id} className={styles.commonTag} title={tag.title}>
                      {tag.name} <span className={styles.commonTagCount}>{tag.trackCount}</span>
                    </span>
                  ),
                )}
                {hiddenTrackTagCount > 0 ? (
                  <span
                    className={styles.moreTags}
                    title={`Select this ${entityLabelLower} to see every tag from its tracks`}
                  >
                    +{hiddenTrackTagCount}
                  </span>
                ) : null}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {hasScores || hasProgress || average || status ? (
        <div className={styles.aside}>
          {hasScores ? (
            <div className={styles.scores}>
              {rating > 0 ? (
                <span
                  className={styles.rating}
                  title={`Your ${entityLabelLower} rating: ${rating}`}
                  aria-label={`Your ${entityLabelLower} rating: ${rating} stars`}
                  role="img"
                >
                  <ReactStars
                    key={`rating-${rating}`}
                    count={5}
                    value={rating}
                    edit={false}
                    size={14}
                    isHalf={true}
                    emptyIcon={<FontAwesomeIcon icon={faStar} />}
                    halfIcon={<FontAwesomeIcon icon={faStarHalf} />}
                    fullIcon={<FontAwesomeIcon icon={faStar} />}
                    activeColor="#ffd700"
                    color="var(--tagify-rating-control-muted, var(--spice-button-disabled))"
                  />
                </span>
              ) : null}
              {energy > 0 ? (
                <span className={styles.energy} title={`${entityLabel} energy: ${energy}`}>
                  {energy}
                </span>
              ) : null}
            </div>
          ) : null}

          {hasProgress ? (
            <div className={styles.progress} title={progressTitle}>
              {progressBar ? <span className={styles.progressBar}>{progressBar}</span> : null}
              {progressText ? (
                <span
                  className={`${styles.progressText} ${isProgressComplete ? styles.progressComplete : ""}`}
                >
                  {progressText}
                </span>
              ) : null}
            </div>
          ) : null}

          {average ? (
            <span className={styles.average} title={average.title}>
              <Star size={11} fill="currentColor" aria-hidden="true" />
              {average.text}
            </span>
          ) : null}

          {status ? <span className={styles.status}>{status}</span> : null}
        </div>
      ) : null}
    </li>
  );
}

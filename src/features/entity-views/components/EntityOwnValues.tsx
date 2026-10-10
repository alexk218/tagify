import React from "react";
import ReactStars from "react-rating-stars-component";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faStar, faStarHalf } from "@fortawesome/free-solid-svg-icons";
import { X } from "lucide-react";
import type { CustomTagAccent } from "@/types/tagData";
import type { ResolvedTagNode } from "@/utils/tagTaxonomy";
import { buildTagAccentCssVars } from "@/features/tag-data/utils/tagAccent";
import { PrivateNote } from "@/features/private-notes/components/PrivateNote";
import { getTagifyDatabaseName } from "@/services/sync/SyncLocalState";
import styles from "./EntityOwnValues.module.css";

interface EntityOwnValuesProps {
  uri: string;
  /** "Album", "Playlist", or "Artist". */
  entityLabel: string;
  rating: number;
  energy: number;
  onSetRating: (rating: number) => void;
  onSetEnergy: (energy: number) => void;
  /** Tags already sorted for display. */
  tags: ResolvedTagNode[];
  customAccentsById: Record<string, CustomTagAccent>;
  activeTagFilters: readonly string[];
  excludedTagFilters: readonly string[];
  onToggleTagFilter: (tagId: string) => void;
  onRemoveTag: (tagId: string) => void;
  /** An action that uses these values, shown at the end of the tags row. */
  tagsAction?: React.ReactNode;
}

function energyFromClick(event: React.MouseEvent<HTMLInputElement>): number {
  const rect = event.currentTarget.getBoundingClientRect();
  const percentage = (event.clientX - rect.left) / rect.width;
  return Math.max(1, Math.min(10, Math.round(1 + percentage * 9)));
}

/** What the user has set on an album, playlist, or artist itself, apart from its tracks. */
export function EntityOwnValues({
  uri,
  entityLabel,
  rating,
  energy,
  onSetRating,
  onSetEnergy,
  tags,
  customAccentsById,
  activeTagFilters,
  excludedTagFilters,
  onToggleTagFilter,
  onRemoveTag,
  tagsAction,
}: EntityOwnValuesProps) {
  const entityLabelLower = entityLabel.toLowerCase();

  return (
    <div className={styles.panel}>
      <div className={styles.controls}>
        <div className={styles.control}>
          <span className={styles.label}>
            Your {entityLabelLower} rating
            {rating > 0 ? <span className={styles.ratingValue}>{rating}</span> : null}
          </span>
          <div className={styles.controlRow}>
            <div className={styles.stars} key={`stars-${rating}`}>
              <ReactStars
                count={5}
                value={rating}
                onChange={(nextRating: number) => onSetRating(nextRating)}
                size={24}
                isHalf={true}
                emptyIcon={<FontAwesomeIcon icon={faStar} />}
                halfIcon={<FontAwesomeIcon icon={faStarHalf} />}
                fullIcon={<FontAwesomeIcon icon={faStar} />}
                activeColor="#ffd700"
                color="var(--tagify-rating-control-muted, var(--spice-button-disabled))"
              />
            </div>
            {rating > 0 ? (
              <button
                type="button"
                className={styles.clearButton}
                onClick={() => onSetRating(0)}
                aria-label={`Clear ${entityLabelLower} rating`}
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>

        <div className={styles.control}>
          <span className={styles.label}>
            {entityLabel} energy
            {energy > 0 ? <span className={styles.energyValue}>{energy}</span> : null}
          </span>
          <div className={styles.controlRow}>
            <input
              type="range"
              min="1"
              max="10"
              value={energy || 5}
              data-is-set={energy > 0 ? "true" : "false"}
              className={`${styles.energySlider} ${energy === 0 ? styles.energySliderUnset : ""}`}
              onChange={(event) => onSetEnergy(parseInt(event.target.value, 10))}
              onClick={(event) => onSetEnergy(energyFromClick(event))}
              onDoubleClick={() => onSetEnergy(0)}
              aria-label={`${entityLabel} energy`}
              title={energy > 0 ? "Double-click to clear" : "Choose an energy level"}
            />
            {energy > 0 ? (
              <button
                type="button"
                className={styles.clearButton}
                onClick={() => onSetEnergy(0)}
                aria-label={`Clear ${entityLabelLower} energy`}
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <PrivateNote key={`${getTagifyDatabaseName()}:${uri}`} uri={uri} inline />

      <div className={styles.tagsRow}>
        <span className={styles.rowLabel}>{entityLabel} tags</span>
        {tags.length > 0 ? (
          <div className={styles.tags} aria-label={`${entityLabel} tags`}>
            {tags.map((tag) => {
              const isActive = activeTagFilters.includes(tag.id);
              const isExcluded = excludedTagFilters.includes(tag.id);
              const isFiltering = isActive || isExcluded;

              return (
                <span
                  key={tag.id}
                  className={`${styles.tag} ${tag.tag.accentId ? styles.tagAccented : ""} ${
                    isActive ? styles.tagActive : ""
                  } ${isExcluded ? styles.tagExcluded : ""}`}
                  style={buildTagAccentCssVars(tag.tag.accentId ?? null, customAccentsById)}
                >
                  <button
                    type="button"
                    className={styles.tagLabelButton}
                    onClick={() => onToggleTagFilter(tag.id)}
                    aria-label={isFiltering ? `Remove "${tag.name}" filter` : `Include "${tag.name}"`}
                    title={
                      isFiltering
                        ? `Remove "${tag.name}" from ${entityLabelLower} filters`
                        : `Filter ${entityLabelLower}s by "${tag.name}"`
                    }
                  >
                    {tag.name}
                  </button>
                  <button
                    type="button"
                    className={styles.removeTag}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemoveTag(tag.id);
                    }}
                    title={`Remove "${tag.name}" from this ${entityLabelLower}`}
                    aria-label={`Remove "${tag.name}" from this ${entityLabelLower}`}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
              );
            })}
          </div>
        ) : (
          <span className={styles.noTags}>None yet. Choose tags below.</span>
        )}
        {tagsAction ? <span className={styles.tagsAction}>{tagsAction}</span> : null}
      </div>
    </div>
  );
}

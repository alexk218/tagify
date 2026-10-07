import React from "react";
import { Star } from "lucide-react";
import type { AlbumTrackSummary, CustomTagAccent, TrackData } from "@/types/tagData";
import type { ResolvedTagNode } from "@/utils/tagTaxonomy";
import { buildTagAccentCssVars } from "@/features/tag-data";
import {
  describeAlbumProgress,
  formatTrackAverage,
  getAlbumProgress,
} from "../utils/albumTrackSummary";
import AlbumProgressBar from "./AlbumProgressBar";
import AlbumTrackList, { type AlbumTrackIdentity } from "./AlbumTrackList";
import styles from "./AlbumTrackInsights.module.css";

interface AlbumTrackInsightsProps {
  albumUri: string;
  tracks: Record<string, TrackData>;
  onTagTrack: (trackUri: string) => void;
  onRateTrack: (trackUri: string, rating: number, track: AlbumTrackIdentity) => void;
  summary?: AlbumTrackSummary;
  totalTrackCount: number | null;
  resolvedLookup: Map<string, ResolvedTagNode>;
  customAccentsById: Record<string, CustomTagAccent>;
  activeTagFilters: string[];
  excludedTagFilters: string[];
  onToggleTagIncludeOff: (tagId: string) => void;
}

function pluralizeTracks(count: number): string {
  return `${count} ${count === 1 ? "track" : "tracks"}`;
}

const AlbumTrackInsights: React.FC<AlbumTrackInsightsProps> = ({
  albumUri,
  tracks,
  onTagTrack,
  onRateTrack,
  summary,
  totalTrackCount,
  resolvedLookup,
  customAccentsById,
  activeTagFilters,
  excludedTagFilters,
  onToggleTagIncludeOff,
}) => {
  const progress = getAlbumProgress(summary?.taggedTrackCount || 0, totalTrackCount);
  const progressDescription = describeAlbumProgress(
    progress.taggedTrackCount,
    progress.totalTrackCount,
  );
  const commonTags = (summary?.commonTags || []).flatMap((tag) => {
    const resolved = resolvedLookup.get(tag.tagId);
    return resolved ? [{ ...tag, resolved }] : [];
  });

  // A single's one track is listed below, so progress would only repeat it.
  const showsProgress = progress.totalTrackCount !== 1;

  return (
    <section className={styles.insights} aria-label="Tracks on this album">
      <div className={styles.header}>
        <h3 className={styles.title}>{progress.totalTrackCount === 1 ? "Track" : "Tracks"}</h3>
        {showsProgress && (progress.taggedTrackCount > 0 || progress.totalTrackCount !== null) ? (
          <span className={styles.progressText}>{progressDescription}</span>
        ) : null}
      </div>

      {showsProgress ? (
        <AlbumProgressBar progress={progress} label="Album progress" size="large" />
      ) : null}

      {summary && (summary.ratingAverage !== null || summary.energyAverage !== null) ? (
        <dl className={styles.stats}>
          {summary.ratingAverage !== null ? (
            <div className={styles.stat}>
              <dt>Average rating</dt>
              <dd>
                <Star
                  className={styles.starIcon}
                  size={13}
                  fill="currentColor"
                  aria-hidden="true"
                />
                <span className={styles.statValue}>
                  {formatTrackAverage(summary.ratingAverage)}
                </span>
                <span className={styles.statSource}>
                  from {pluralizeTracks(summary.ratedTrackCount)}
                </span>
              </dd>
            </div>
          ) : null}
          {summary.energyAverage !== null ? (
            <div className={styles.stat}>
              <dt>Average energy</dt>
              <dd>
                <span className={`${styles.statValue} ${styles.energyValue}`}>
                  {formatTrackAverage(summary.energyAverage)}
                </span>
                <span className={styles.statSource}>
                  from {pluralizeTracks(summary.energyTrackCount)}
                </span>
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {summary && commonTags.length > 0 ? (
        <div className={styles.commonTags}>
          <span className={styles.rowLabel}>Common tags</span>
          <div className={styles.tagList} aria-label="Common tags on your tracks">
            {commonTags.map(({ tagId, trackCount, resolved }) => {
              const isActive = activeTagFilters.includes(tagId);
              const isExcluded = excludedTagFilters.includes(tagId);

              return (
                <button
                  type="button"
                  key={tagId}
                  className={`${styles.tag} ${resolved.tag.accentId ? styles.tagAccented : ""} ${
                    isActive ? styles.tagActive : ""
                  } ${isExcluded ? styles.tagExcluded : ""}`}
                  style={buildTagAccentCssVars(resolved.tag.accentId ?? null, customAccentsById)}
                  onClick={() => onToggleTagIncludeOff(tagId)}
                  title={`${resolved.name} is on ${trackCount} of the ${pluralizeTracks(
                    summary.taggedTrackCount,
                  )} you've rated or tagged. ${
                    isActive || isExcluded
                      ? "Click to stop filtering albums by it."
                      : "Click to filter albums by it."
                  }`}
                >
                  <span>{resolved.name}</span>
                  <span className={styles.tagCount} aria-label={pluralizeTracks(trackCount)}>
                    {trackCount}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <AlbumTrackList
        key={albumUri}
        albumUri={albumUri}
        tracks={tracks}
        resolvedLookup={resolvedLookup}
        customAccentsById={customAccentsById}
        onTagTrack={onTagTrack}
        onRateTrack={onRateTrack}
      />
    </section>
  );
};

export default AlbumTrackInsights;

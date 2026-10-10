import React, { useMemo } from "react";
import { useAlbumMembership } from "../hooks/useAlbumTracks";
import { buildAlbumTrackSummaries } from "../utils/albumTrackSummary";
import type { AlbumTrackSummary, CustomTagAccent, TagTaxonomy, TrackData } from "@/types/tagData";
import type { ResolvedTagNode } from "@/utils/tagTaxonomy";
import { SuggestedTrackTags } from "@/features/track-insights";
import { TrackSummaryPanel, type TrackSummaryStat } from "@/features/entity-views";
import {
  describeAlbumProgress,
  formatTrackAverage,
  getAlbumProgress,
} from "../utils/albumTrackSummary";
import AlbumProgressBar from "./AlbumProgressBar";
import AlbumTrackList, { type AlbumTrackIdentity } from "./AlbumTrackList";

interface AlbumTrackInsightsProps {
  albumUri: string;
  tracks: Record<string, TrackData>;
  taxonomy: TagTaxonomy;
  onTagTrack: (trackUri: string) => void;
  onRateTrack: (trackUri: string, rating: number, track: AlbumTrackIdentity) => void;
  summary?: AlbumTrackSummary;
  totalTrackCount: number | null;
  resolvedLookup: Map<string, ResolvedTagNode>;
  customAccentsById: Record<string, CustomTagAccent>;
  appliedTagIds?: readonly string[];
  onAddTag: (tagId: string) => void;
}

function pluralizeTracks(count: number): string {
  return `${count} ${count === 1 ? "track" : "tracks"}`;
}

const AlbumTrackInsights: React.FC<AlbumTrackInsightsProps> = ({
  albumUri,
  tracks,
  taxonomy,
  onTagTrack,
  onRateTrack,
  summary: savedSummary,
  totalTrackCount,
  resolvedLookup,
  customAccentsById,
  appliedTagIds,
  onAddTag,
}) => {
  const membership = useAlbumMembership();
  const summary = useMemo(() => membership[albumUri]
    ? buildAlbumTrackSummaries(tracks, taxonomy, { [albumUri]: membership[albumUri] }).get(albumUri)
    : savedSummary, [membership, albumUri, tracks, taxonomy, savedSummary]);
  const progress = getAlbumProgress(summary?.taggedTrackCount || 0, summary?.totalTrackCount ?? totalTrackCount);
  const progressDescription = describeAlbumProgress(
    progress.taggedTrackCount,
    progress.totalTrackCount,
  );
  // A single's one track is listed below, so progress would only repeat it.
  const showsProgress = progress.totalTrackCount !== 1;

  const stats: TrackSummaryStat[] = [];
  if (summary && summary.ratingAverage !== null) {
    stats.push({
      kind: "rating",
      label: "Track average",
      value: formatTrackAverage(summary.ratingAverage),
      source: `from ${pluralizeTracks(summary.ratedTrackCount)}`,
    });
  }
  if (summary && summary.energyAverage !== null) {
    stats.push({
      kind: "energy",
      label: "Average energy",
      value: formatTrackAverage(summary.energyAverage),
      source: `from ${pluralizeTracks(summary.energyTrackCount)}`,
    });
  }

  return (
    <TrackSummaryPanel
      label="Tracks on this album"
      title={progress.totalTrackCount === 1 ? "Track" : "Tracks"}
      summary={showsProgress && (progress.taggedTrackCount > 0 || progress.totalTrackCount !== null)
        ? progressDescription
        : null}
      progress={showsProgress ? (
        <AlbumProgressBar progress={progress} label="Album progress" size="large" />
      ) : null}
      stats={stats}
    >
      {summary ? <SuggestedTrackTags summary={summary} taxonomy={taxonomy}
        appliedTagIds={appliedTagIds} entityLabel="album" onAddTag={onAddTag} /> : null}

      <AlbumTrackList
        key={albumUri}
        albumUri={albumUri}
        tracks={tracks}
        resolvedLookup={resolvedLookup}
        customAccentsById={customAccentsById}
        onTagTrack={onTagTrack}
        onRateTrack={onRateTrack}
      />
    </TrackSummaryPanel>
  );
};

export default AlbumTrackInsights;

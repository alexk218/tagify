import { AlbumProgressBar, getAlbumProgress } from "@/features/playlist-state";
import React from "react";
import { TrackSummaryAction, TrackSummaryPanel, type TrackSummaryStat } from "@/features/entity-views";
import type { AlbumTrackSummary, TagTaxonomy } from "@/types/tagData";
import type { PlaylistTrackInsights } from "../hooks/usePlaylistTrackInsights";
import type { ArtistTrackInsights } from "../hooks/useArtistTrackInsights";
import { SuggestedTrackTags } from "./SuggestedTrackTags";

interface Props {
  summary?: AlbumTrackSummary;
  playlist?: PlaylistTrackInsights;
  artist?: ArtistTrackInsights;
  onRefresh?: () => void;
  taxonomy: TagTaxonomy;
  appliedTagIds?: readonly string[];
  onAddTag: (tagId: string) => void;
  entityLabel: "artist" | "playlist";
}

function pluralizeTracks(count: number): string {
  return `${count} ${count === 1 ? "track" : "tracks"}`;
}

/** What the user's tracks say about a playlist or artist, shown in its details. */
export function TrackInsightStats({ summary, playlist, artist, onRefresh, taxonomy, appliedTagIds = [], onAddTag,
  entityLabel }: Props) {
  if (!summary && !playlist) return null;
  const isPlaylist = entityLabel === "playlist";
  const partial = Boolean(artist?.pendingCount);
  const totalTrackCount = playlist?.totalTrackCount;
  const emptyPlaylist = totalTrackCount === 0;
  const status = playlist?.status;

  const summaryText = emptyPlaylist
    ? "No tracks in this playlist yet."
    : summary
      ? totalTrackCount !== undefined
        ? `${summary.taggedTrackCount} of ${totalTrackCount} distinct tracks rated or tagged`
        : `${pluralizeTracks(summary.taggedTrackCount)} rated or tagged`
      : status === "loading"
        ? <span role="status">Checking playlist tracks…</span>
        : status === "failed"
          ? <span role="status">Couldn't check playlist tracks.</span>
          : null;
  // Refreshing keeps the heading in place instead of adding and removing a line.
  const action = status === "loading" && summary
    ? <span role="status">Refreshing tracks…</span>
    : status === "failed" && onRefresh
      ? <TrackSummaryAction onClick={onRefresh}>Try again</TrackSummaryAction>
      : status === "loaded" && onRefresh
        ? <TrackSummaryAction onClick={onRefresh}>Refresh tracks</TrackSummaryAction>
        : null;

  const stats: TrackSummaryStat[] = [];
  if (summary && summary.ratingAverage !== null) {
    stats.push({
      kind: "rating",
      label: "Track average",
      value: summary.ratingAverage.toFixed(1),
      source: `from ${pluralizeTracks(summary.ratedTrackCount)}`,
      title: `Average of ${summary.ratedTrackCount} rated tracks; unrated tracks are excluded`,
    });
  }
  if (summary && summary.energyAverage !== null) {
    stats.push({
      kind: "energy",
      label: "Average energy",
      value: summary.energyAverage.toFixed(1),
      source: `from ${pluralizeTracks(summary.energyTrackCount)}`,
    });
  }

  const notices: React.ReactNode[] = [];
  if (status === "failed" && summary) {
    notices.push(<span key="failed" role="status">Couldn't refresh tracks. Showing the last checked playlist.</span>);
  }
  if (summary && summary.ratingAverage === null && !emptyPlaylist) {
    notices.push(<span key="average">{partial
      ? "Not enough checked ratings for an average yet."
      : summary.ratedTrackCount === 1
        ? "Rate one more track to see an average."
        : "Rate at least two tracks to see an average."}</span>);
  }
  if (partial && summary) {
    notices.push(<span key="partial">Based on the tracks checked so far.</span>);
  }

  return (
    <TrackSummaryPanel
      label={isPlaylist ? "Tracks in this playlist" : "Your tracks by this artist"}
      title={isPlaylist ? "Tracks" : "Your tracks"}
      summary={summaryText}
      action={action}
      progress={summary && totalTrackCount ? (
        <AlbumProgressBar
          progress={getAlbumProgress(summary.taggedTrackCount, totalTrackCount)}
          label="Playlist progress"
          size="large"
        />
      ) : null}
      stats={stats}
      notices={notices.length > 0 ? notices : null}
    >
      {summary ? (
        <SuggestedTrackTags
          summary={summary}
          taxonomy={taxonomy}
          appliedTagIds={appliedTagIds}
          entityLabel={entityLabel}
          onAddTag={onAddTag}
          partial={partial}
        />
      ) : null}
    </TrackSummaryPanel>
  );
}

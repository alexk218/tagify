import { albumTrackListsStore } from "../services/albumTrackLists";
import React, { useMemo, useState } from "react";
import type { CustomTagAccent, TrackData } from "@/types/tagData";
import {
  compareResolvedTagsByTaxonomyOrder,
  type ResolvedTagNode,
} from "@/utils/tagTaxonomy";
import { buildTagAccentCssVars } from "@/features/tag-data";
import { useAlbumTracks } from "../hooks/useAlbumTracks";
import AlbumTrackRating from "./AlbumTrackRating";
import styles from "./AlbumTrackList.module.css";
import { usePrivateNotePreviews } from "@/features/private-notes/hooks/usePrivateNotePreviews";
import { PrivateNotePreview, PrivateNotePreviewError } from "@/features/private-notes/components/PrivateNotePreview";

export interface AlbumTrackIdentity {
  name: string;
  artists: string;
}

interface AlbumTrackListProps {
  albumUri: string;
  tracks: Record<string, TrackData>;
  resolvedLookup: Map<string, ResolvedTagNode>;
  customAccentsById: Record<string, CustomTagAccent>;
  onTagTrack: (trackUri: string) => void;
  onRateTrack: (trackUri: string, rating: number, track: AlbumTrackIdentity) => void;
}

interface AlbumTrackRow {
  uri: string;
  name: string;
  artists: string;
  discNumber: number | null;
  trackNumber: number | null;
  data?: TrackData;
}

const COLLAPSED_ROW_COUNT = 12;

/** Every track on the album with what the user has set on it. */
const AlbumTrackList: React.FC<AlbumTrackListProps> = ({
  albumUri,
  tracks,
  resolvedLookup,
  customAccentsById,
  onTagTrack,
  onRateTrack,
}) => {
  const [showAll, setShowAll] = useState(false);
  const albumTracks = useAlbumTracks(albumUri);
  const rows = useMemo<AlbumTrackRow[]>(() => {
    const taggedOnAlbum = Object.entries(tracks).filter(
      ([, track]) => track.albumUri === albumUri && (track.rating > 0 || track.energy > 0 || track.tagIds.some((id) => resolvedLookup.has(id))),
    );
    const listed = Array.from(new Map(albumTracks.tracks.map((track) => [track.uri, track])).values()).map((track) => ({
      uri: track.uri,
      name: track.name,
      artists: track.artists,
      discNumber: track.discNumber,
      trackNumber: track.trackNumber,
      data: tracks[track.uri],
    }));
    const listedUris = new Set(listed.map((row) => row.uri));
    // Spotify can relink a track to another version, so tagged tracks it
    // no longer lists still appear here.
    const unlisted = taggedOnAlbum
      .filter(([trackUri]) => !listedUris.has(trackUri))
      .map(([trackUri, track]) => ({
        uri: trackUri,
        name: track.name || "Unknown Track",
        artists: track.artists || "",
        discNumber: null,
        trackNumber: null,
        data: track,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));

    return [...listed, ...unlisted];
  }, [albumTracks.tracks, albumUri, tracks, resolvedLookup]);
  const hasSeveralDiscs = new Set(rows.map((row) => row.discNumber ?? 0)).size > 1;
  const visibleRows = showAll ? rows : rows.slice(0, COLLAPSED_ROW_COUNT);
  const notePreviews = usePrivateNotePreviews(visibleRows.map(row => row.uri));

  if (albumTracks.status === "loading") {
    return <p className={styles.status}>Loading tracks…</p>;
  }

  return (
    <div className={styles.trackList}>
      {notePreviews.error && <PrivateNotePreviewError onRetry={notePreviews.retry} />}
      {albumTracks.status === "failed" ? (
        <p className={styles.status}>
          {rows.length > 0
            ? "Spotify didn't list this album's other tracks right now, so only the ones you've rated or tagged are shown."
            : "Spotify didn't list this album's tracks right now."}
          {" "}<button type="button" onClick={() => { void albumTrackListsStore.request(albumUri, true); }}>Try again</button>
        </p>
      ) : null}

      <ol className={styles.rows}>
        {visibleRows.map((row, index) => {
          const previousRow = visibleRows[index - 1];
          const startsDisc =
            hasSeveralDiscs &&
            row.discNumber !== null &&
            row.discNumber !== (previousRow?.discNumber ?? null);
          const data = row.data && (row.data.rating > 0 || row.data.energy > 0 || row.data.tagIds.some((id) => resolvedLookup.has(id))) ? row.data : undefined;
          const tags = (data?.tagIds || [])
            .map((tagId) => resolvedLookup.get(tagId))
            .filter((tag): tag is ResolvedTagNode => Boolean(tag))
            .sort(compareResolvedTagsByTaxonomyOrder);
          const rate = (nextRating: number) =>
            onRateTrack(row.uri, nextRating, {
              name: row.name,
              artists: row.artists || "Unknown Artist",
            });

          return (
            <li key={row.uri}>
              {startsDisc ? <span className={styles.disc}>Disc {row.discNumber}</span> : null}
              <div className={`${styles.row} ${data ? "" : styles.rowEmpty}`}>
                <button
                  type="button"
                  className={styles.open}
                  onClick={() => onTagTrack(row.uri)}
                  title={`${data ? "Edit" : "Tag"} "${row.name}" in Tracks`}
                  aria-label={`${data ? "Edit" : "Tag"} "${row.name}" in Tracks`}
                >
                  <span className={styles.number}>{row.trackNumber ?? ""}</span>
                  <span className={styles.main}>
                    <span className={styles.name}>{row.name}</span>
                    {tags.length > 0 ? (
                      <span className={styles.tags}>
                        {tags.map((tag) => (
                          <span
                            key={tag.id}
                            className={`${styles.tag} ${tag.tag.accentId ? styles.tagAccented : ""}`}
                            style={buildTagAccentCssVars(tag.tag.accentId ?? null, customAccentsById)}
                          >
                            {tag.name}
                          </span>
                        ))}
                      </span>
                    ) : null}
                    <PrivateNotePreview text={notePreviews.texts[row.uri]} trackName={row.name} />
                  </span>
                </button>
                <span className={styles.values}>
                  <AlbumTrackRating trackName={row.name} rating={data?.rating ?? 0} onRate={rate} />
                  <span className={styles.energySlot}>
                    {data && data.energy > 0 ? (
                      <span className={styles.energy} title={`Energy ${data.energy}`}>
                        {data.energy}
                      </span>
                    ) : null}
                  </span>
                </span>
              </div>
            </li>
          );
        })}
      </ol>

      {rows.length > COLLAPSED_ROW_COUNT ? (
        <button
          type="button"
          className={styles.showAll}
          onClick={() => setShowAll((current) => !current)}
        >
          {showAll ? "Show fewer tracks" : `Show all ${rows.length} tracks`}
        </button>
      ) : null}
    </div>
  );
};

export default AlbumTrackList;

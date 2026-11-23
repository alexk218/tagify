import React, { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowUpRightFromSquare } from "@fortawesome/free-solid-svg-icons";
import {
  COMMUNITY_ONLY_SMART_PLAYLISTS_EVENT,
  readCommunityOnlySmartPlaylists,
  syncAccountId,
  type CommunityOnlySmartPlaylist,
} from "@/services/sync/SmartPlaylistCommunityList";
import { COMMUNITY_PAGES_ORIGIN } from "@/features/community/communityLinks";
import type { SmartPlaylistFilterCriteria } from "@/features/smart-playlists/model/smartPlaylist.types";
import { formatCondensedDate } from "@/utils/formatters";
import styles from "./SmartPlaylistModal.module.css";
import { openCommunityUrlSignedIn } from "@/features/community/communityWebsiteLink";

// Smart playlists made on Community that Tagify can't change itself (everyone's tags, one person's
// tag, or Length / Released rules set on Community). Alex, 2026-11-17, on the Picks row
// pr1527-desktop-smart-playlists-community-rows: "the Community playlists should be basically
// indistinguishable from the ones on desktop. perhaps a "+ new (from Community)" type of badge the
// first time a new Community playlist is there. but besides that it should behave and look exactly
// the same as any other." So each one is a normal row in the one list, laid out like the others,
// sorted and searched with them. What differs is only what Community has to do: Edit Filters opens
// Community, and the sync status says Community keeps it updated (there is no Sync Now or Disable
// Sync, because Community fills these playlists and refuses those changes from Tagify).

export function useCommunityOnlySmartPlaylists(): CommunityOnlySmartPlaylist[] {
  const [playlists, setPlaylists] = useState<CommunityOnlySmartPlaylist[]>(readCommunityOnlySmartPlaylists);
  useEffect(() => {
    const update = (event: Event) => {
      const next = (event as CustomEvent<{ playlists?: CommunityOnlySmartPlaylist[] }>).detail?.playlists;
      setPlaylists(Array.isArray(next) ? next : readCommunityOnlySmartPlaylists());
    };
    window.addEventListener(COMMUNITY_ONLY_SMART_PLAYLISTS_EVENT, update);
    return () => window.removeEventListener(COMMUNITY_ONLY_SMART_PLAYLISTS_EVENT, update);
  }, []);
  return playlists;
}

/** Community's Smart playlists page (it has no page per playlist). */
export const COMMUNITY_SMART_PLAYLISTS_URL = `${COMMUNITY_PAGES_ORIGIN}/library/playlists`;

export function openSmartPlaylistsOnCommunity(): void {
  void openCommunityUrlSignedIn(COMMUNITY_SMART_PLAYLISTS_URL);
}

/** Where the songs come from, when it isn't your own tags (a rule like any other). */
export function sourceLabel(playlist: Pick<CommunityOnlySmartPlaylist, "source">): string | null {
  if (playlist.source === "community") return "Everyone’s tags";
  if (playlist.source === "member") return "One person’s tag";
  return null;
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const whole = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const range = (value: unknown) => (record(value) ? { min: whole(value.min), max: whole(value.max) } : { min: null, max: null });
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
const operator = (value: unknown) => (value === "OR" ? "OR" : "AND") as "AND" | "OR";

/** Community's rules in Tagify's own shape, so the row describes them exactly as it does every other playlist's. */
export function communityPlaylistCriteria(playlist: Pick<CommunityOnlySmartPlaylist, "rules">): SmartPlaylistFilterCriteria {
  const rules = record(playlist.rules) ? playlist.rules : {};
  const clauses = (Array.isArray(rules.clauses) ? rules.clauses : []).filter(record).map((clause) => ({
    tagIds: strings(clause.tagIds),
    excludedTagIds: strings(clause.excludedTagIds),
    operator: operator(clause.operator),
  }));
  const energy = range(rules.energy);
  const bpm = range(rules.bpm);
  const length = range(rules.length);
  const released = range(rules.released);
  return {
    includeTagClauses: clauses,
    clauseConnectors: (Array.isArray(rules.connectors) ? rules.connectors : []).map(operator),
    ratingFilters: (Array.isArray(rules.ratings) ? rules.ratings : []).filter((value): value is number => typeof value === "number"),
    energyMinFilter: energy.min,
    energyMaxFilter: energy.max,
    bpmMinFilter: bpm.min,
    bpmMaxFilter: bpm.max,
    camelotKeyFilters: strings(rules.keys),
    lengthMinFilter: length.min,
    lengthMaxFilter: length.max,
    releaseYearMinFilter: released.min,
    releaseYearMaxFilter: released.max,
  };
}

/** How many people must agree, for everyone's-tags playlists that ask for more than one. */
export function minPeopleLabel(playlist: Pick<CommunityOnlySmartPlaylist, "rules">): string | null {
  const people = whole((playlist.rules as { minPeople?: unknown } | null)?.minPeople);
  return people && people > 1 ? `${people}+ people agree` : null;
}

// --- "New from Community" ------------------------------------------------------------------------

const SEEN_KEY = "tagify:smart-playlists:community-seen:v1:";
/** Local playlists made on Community from your tags carry this id until edited in Tagify. */
export const COMMUNITY_MADE_ID_PREFIX = "community-playlist:";

function seenKey(): string | null {
  const account = syncAccountId();
  return account ? `${SEEN_KEY}${account}` : null;
}

function readSeen(key: string): Set<string> | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "null");
    return Array.isArray(parsed) ? new Set(parsed.filter((item): item is string => typeof item === "string")) : null;
  } catch {
    return null;
  }
}

/**
 * The playlists to badge "New from Community": made on Community and not yet seen in this window.
 * Each badge stays until the window closes, so the next time it opens the playlist reads like any other.
 */
export function useNewFromCommunity(ids: string[]): Set<string> {
  const key = useMemo(seenKey, []);
  const [seenAtOpen] = useState(() => (key ? readSeen(key) : null));
  const idsKey = ids.join("\n");
  useEffect(() => {
    if (!key || !ids.length) return;
    try {
      const seen = readSeen(key) ?? new Set<string>();
      if (ids.every((id) => seen.has(id))) return;
      ids.forEach((id) => seen.add(id));
      localStorage.setItem(key, JSON.stringify([...seen]));
    } catch { /* best effort */ }
  }, [key, idsKey]);
  return useMemo(() => new Set(key ? ids.filter((id) => !seenAtOpen?.has(id)) : []), [key, idsKey, seenAtOpen]);
}

export function NewFromCommunityBadge() {
  return <span className={styles.newFromCommunityLabel} title="Made on Tagify Community">+ New from Community</span>;
}

// --- The row -------------------------------------------------------------------------------------

export interface CommunitySmartPlaylistRowProps {
  playlist: CommunityOnlySmartPlaylist;
  isNew: boolean;
  /** The rules, described as every other row describes them. */
  includeTagFormula: string;
  criteriaTokens: string[];
  onOpenInSpotify: (spotifyPlaylistId: string) => void;
  onRemove: (playlist: CommunityOnlySmartPlaylist) => void;
}

/** A Community-filled playlist as a normal row of the one list. */
export function CommunitySmartPlaylistRow({ playlist, isNew, includeTagFormula, criteriaTokens, onOpenInSpotify, onRemove }: CommunitySmartPlaylistRowProps) {
  const created = Date.parse(playlist.createdAt);
  return (
    <div className={styles.playlistItem} data-community-playlist={playlist.id}>
      <div className={styles.playlistHeader}>
        <div className={styles.playlistTitleSection}>
          <h3
            className={styles.playlistName}
            onClick={() => playlist.spotifyPlaylistId && onOpenInSpotify(playlist.spotifyPlaylistId)}
          >
            {playlist.name}
          </h3>
          {isNew ? <NewFromCommunityBadge /> : null}
        </div>
        {Number.isFinite(created) ? (
          <div className={styles.playlistMetadata}>
            <span className={styles.timeStamp}>Created {formatCondensedDate(created, "short")}</span>
          </div>
        ) : null}
      </div>

      <div className={styles.playlistStatsRow}>
        <div className={styles.trackRowItem}>
          <div className={styles.trackCountNumber}>{playlist.trackCount.toLocaleString()}</div>
          <div className={styles.trackCountLabel}>In Playlist</div>
        </div>
        <span
          className={`${styles.syncIndicator} ${styles.unknown}`}
          title="Tagify Community keeps this playlist up to date in Spotify."
        >
          Kept updated by Community
        </span>
      </div>

      {includeTagFormula || criteriaTokens.length ? (
        <div className={styles.criteriaSection}>
          <div className={styles.criteriaList}>
            {includeTagFormula ? (
              <div className={styles.criteriaItem}>
                <span className={styles.criteriaLabel}>Match</span>
                <span className={styles.criteriaValue}>{includeTagFormula}</span>
              </div>
            ) : null}
            {criteriaTokens.map((token, index) => (
              <div key={`${playlist.id}-${index}`} className={styles.criteriaItem}>
                <span className={styles.criteriaValue}>{token}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className={styles.noCriteria}><span>No filters set</span></div>
      )}

      <div className={styles.playlistActions}>
        <button
          type="button"
          className={styles.actionButton}
          onClick={openSmartPlaylistsOnCommunity}
          title="These rules are changed on Tagify Community"
        >
          Edit Filters <FontAwesomeIcon icon={faArrowUpRightFromSquare} size="xs" style={{ marginLeft: 5 }} />
        </button>
        <button
          type="button"
          className={`${styles.actionButton} ${styles.removeTrackingButton}`}
          onClick={() => onRemove(playlist)}
          title="Remove smart-playlist tracking (does not delete the Spotify playlist)"
        >
          Remove Tracking
        </button>
      </div>
    </div>
  );
}

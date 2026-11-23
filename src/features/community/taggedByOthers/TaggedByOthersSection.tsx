import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ListMusic, RefreshCw } from "lucide-react";
import { isSameTagName, sameTagNameKey } from "@tagify/community-contracts";
import type { CommunityMatch, CommunityMatchTag } from "@/features/onboarding/services/communityMatches";
import { playlistsChosenBucket, recordProductInteraction } from "@/features/product-analytics/productAnalytics";
import { LISTS_MAX_SONGS } from "@/services/sync/SpotifyLibrarySender";
import type { TagTaxonomy, TrackData } from "@/types/tagData";
import { plural } from "../communityPublication";
import { communitySwitchOn } from "../communitySwitches";
import { PREVIEW_SONGS_SHOWN, recordCommunityTeaserViewed } from "./communityTeaserPreview";
import type { TaggedByOthersMatch, TaggedByOthersOutcome, TaggedByOthersStop } from "./taggedByOthersScan";
import connectStyles from "./ConnectButton.module.css";
import { LockedSongs } from "./LockedSongs";
import { TaggedByOthersRows, type MergedTag } from "./TaggedByOthersRows";
import { hiddenSongsStore, type HiddenSongsStore } from "./taggedByOthersHidden";
import styles from "./TaggedByOthersSection.module.css";
import { taggedByOthersStore, type TaggedByOthersStore } from "./taggedByOthersStore";
import { taggedByOthersAllowance, type TaggedByOthersAllowance } from "./taggedByOthersAllowance";
import { PlaylistPicker } from "./PlaylistPicker";
import {
  CHECK_AGAIN_AFTER_MS, forgetTaggedByOthers, readPlaylistChoices, useTaggedByOthers,
  type PlaylistChoicesReader, type TaggedByOthersCheck, type TaggedByOthersPlaylistCheck,
} from "./useTaggedByOthers";

/** Songs shown at first, and added by each "Show more". */
export const ROWS_PER_STEP = 50;
/** Search and sort appear once there are more songs than fit at a glance. */
const CONTROLS_FROM = 2;
/** Songs fully usable in the track list before the member shares their tags on Community: as many as
 * the preview shows before connecting, so connecting never shows fewer. */
export const USABLE_BEFORE_SHARING = PREVIEW_SONGS_SHOWN;

interface TaggedByOthersSectionProps {
  connected: boolean;
  /** An approval code is waiting in the browser. */
  connectionPending?: boolean;
  /** The member's Community account; a different account never sees this one's results. */
  accountId: string | null;
  tracks: Record<string, TrackData>;
  taxonomy: TagTaxonomy;
  onConnectCommunity: () => void;
  /** Adds these members' tags to the song in the member's own library. */
  onAddMembersTags: (match: CommunityMatch, tags: CommunityMatchTag[]) => Promise<void>;
  /** Opens a song for tagging. */
  onOpenSong?: (uri: string) => void;
  /** Adds one of members' tags to the song (`on`) or takes it off, with Undo; without it, tags can only be added. */
  onToggleTag?: (match: CommunityMatch, tag: MergedTag, on: boolean) => Promise<void>;
  /** Locks the song in the editor above, as clicking a song in Tagged Tracks does. */
  onLockSong?: (match: CommunityMatch) => void;
  /** The song locked in the editor. */
  activeUri?: string | null;
  onPlaySong?: (uri: string) => void;
  /** The member's own star rating of a song, 0 for none. */
  ratingOf?: (uri: string) => number;
  hiddenStore?: HiddenSongsStore;
  /** Reads the member's own playlists for the playlist picker. */
  listPlaylists?: PlaylistChoicesReader;
  /** Shown as the track list's "Tagged by others" view, whose tab names it: no card title or outline. */
  inTrackList?: boolean;
  /**
   * The member doesn't share their tags on Community (not public yet, private or paused): only the
   * top songs are usable and the rest wait behind `onShareTags`, the existing sharing window.
   */
  sharingLocked?: boolean;
  onShareTags?: () => void;
  check?: TaggedByOthersCheck;
  checkMore?: TaggedByOthersPlaylistCheck;
  allowance?: (account: string) => TaggedByOthersAllowance;
  store?: TaggedByOthersStore;
  now?: () => number;
  /**
   * Not connected: songs of the member's that other members tagged (how many people and their tags,
   * never who), shown as a preview with adding locked until they connect (switch `communityTeasers`).
   */
  preview?: TaggedByOthersPreview;
  /** Not connected: the preview is still being looked up, so the invitation waits instead of flashing first. */
  previewLoading?: boolean;
}

/** A song in the preview for people who aren't connected: no member handles. */
export interface TaggedByOthersPreviewSong extends CommunityMatch {
  people: number;
  peopleCapped: boolean;
}

export interface TaggedByOthersPreview {
  songs: TaggedByOthersPreviewSong[];
  /** Every song found, which can be more than `songs` holds. */
  total: number;
  /** How many of the newest Liked Songs were asked about. */
  asked?: number;
  /** Every Liked Song was asked about, so `total` covers the whole of Liked Songs. */
  complete?: boolean;
}

/** "742 of your Liked Songs", or "of your 5,000 newest Liked Songs" when only the newest were asked about. */
export function previewFoundText(preview: Pick<TaggedByOthersPreview, "total" | "asked" | "complete">, shown = 0): string {
  const total = Math.max(preview.total, shown);
  const newest = !preview.complete && (preview.asked ?? 0) > 0 ? `${preview.asked!.toLocaleString()} newest ` : "";
  return `${total.toLocaleString()} of your ${newest}${total === 1 && !newest ? "Liked Song" : "Liked Songs"}`;
}


const STOP_COPY: Record<Exclude<TaggedByOthersStop, null>, string> = {
  spotify: "Spotify needs a break, so only part of your library was checked. Come back a little later to check the rest.",
  unreachable: "Tagify couldn't reach Community just now.",
  paused: "Community has paused this for now. Check back a little later.",
  busy: "Community has checked as many songs as it can for now. Come back later to check the rest.",
  "not-available": "This isn't available just yet. Check back soon.",
  allowance: "To keep Spotify running smoothly, Tagify takes a break after reading a lot for this list. Come back in an hour or so to check the rest.",
};

/** Stops where Community couldn't answer at all; checking again right away is fine, since little was read. */
const COMMUNITY_FAILED = new Set<TaggedByOthersStop>(["unreachable", "paused", "not-available"]);

type Sort = "members" | "recent";

const coverOf = (match: CommunityMatch) => {
  const url = match.track.album?.images?.[0]?.url ?? "";
  if (url.startsWith("spotify:image:")) return `https://i.scdn.co/image/${url.slice("spotify:image:".length)}`;
  return url.startsWith("https://") ? url : undefined;
};

/** "Tagged by @ana, @sam +3": up to three members by name, then how many more. */
export function taggedByText(match: Pick<TaggedByOthersMatch, "people" | "peopleCapped" | "sample">): string {
  if (!match.sample.length) return `Tagged by ${plural(match.people, "member")}${match.peopleCapped ? " or more" : ""}`;
  const more = match.people - match.sample.length;
  return `Tagged by ${match.sample.map((handle) => `@${handle}`).join(", ")}${more > 0 ? ` +${more.toLocaleString()}${match.peopleCapped ? " or more" : ""}` : ""}`;
}

/** "just now", "5 minutes ago", "3 hours ago", then the day. */
export function checkedWhen(checkedAt: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - checkedAt) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  return `on ${new Date(checkedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

/**
 * "Checked your 26,384 Liked Songs · 630 found" for a whole Liked Songs check, "Checked 500 of your
 * Liked Songs · 12 found" while checking or when it stopped part way, and "Checked 27,100 songs from
 * your Liked Songs and 100 playlists · 640 found" once playlists were checked too.
 */
export function checkedSummary({ scope, checked, matches, stopped, playlistIds = [] }: Pick<TaggedByOthersOutcome, "scope" | "checked" | "matches" | "stopped"> & { playlistIds?: string[] }, checking: boolean): string {
  const found = `${matches.length.toLocaleString()} found`;
  // A check from before Liked Songs-only checks read every playlist and names none.
  if (scope !== "liked" && !playlistIds.length) return `Checked ${plural(checked, "song")} · ${found}`;
  if (scope !== "liked") return `Checked ${plural(checked, "song")} from your Liked Songs and ${plural(playlistIds.length, "playlist")} · ${found}`;
  if (checking || stopped) return `Checked ${checked.toLocaleString()} of your Liked Songs · ${found}`;
  return `Checked your ${checked.toLocaleString()} ${checked === 1 ? "Liked Song" : "Liked Songs"} · ${found}`;
}


/** Tag names in the filter bar before "+N more". */
export const TAG_NAMES_SHOWN = 8;

interface ViewChoices { sort: Sort; notTaggedOnly: boolean }
const CHOICES_KEY = "tagify:tagged-by-others:view:v1:";
const DEFAULT_CHOICES: ViewChoices = { sort: "members", notTaggedOnly: true };
function loadChoices(account: string | null): ViewChoices {
  try {
    const saved = JSON.parse(localStorage.getItem(CHOICES_KEY + (account ?? "")) || "null") as Partial<ViewChoices> | null;
    return {
      sort: saved?.sort === "recent" ? "recent" : "members",
      notTaggedOnly: typeof saved?.notTaggedOnly === "boolean" ? saved.notTaggedOnly : DEFAULT_CHOICES.notTaggedOnly,
    };
  } catch { return DEFAULT_CHOICES; }
}
function saveChoices(account: string | null, choices: ViewChoices) {
  try { localStorage.setItem(CHOICES_KEY + (account ?? ""), JSON.stringify(choices)); } catch { /* Defaults next time. */ }
}

const PLAYLISTS_KEY = "tagify:tagged-by-others:playlists:v1:";
/** The playlists the member chose last time, ticked when the picker opens again. */
function loadPlaylistChoice(account: string | null): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(PLAYLISTS_KEY + (account ?? "")) || "[]");
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : [];
  } catch { return []; }
}
function savePlaylistChoice(account: string, chosen: readonly string[]) {
  try { localStorage.setItem(PLAYLISTS_KEY + account, JSON.stringify(chosen)); } catch { /* Ticked again next time. */ }
}

/** The names other members used across these songs, by how many songs carry each, same names merged. */
export function topTagNames(matches: readonly CommunityMatch[]): { label: string; songs: number }[] {
  const names = new Map<string, { label: string; songs: number; best: number }>();
  for (const match of matches) {
    const seen = new Set<string>();
    for (const tag of match.tags) {
      const key = sameTagNameKey(tag.label) || tag.label;
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = names.get(key);
      if (!entry) names.set(key, { label: tag.label, songs: 1, best: tag.people });
      else { entry.songs += 1; if (tag.people > entry.best) { entry.label = tag.label; entry.best = tag.people; } }
    }
  }
  return [...names.values()].sort((a, b) => b.songs - a.songs || a.label.localeCompare(b.label)).map(({ label, songs }) => ({ label, songs }));
}

/** Artists across these songs, most songs first. */
export function topArtists(matches: readonly CommunityMatch[]): { name: string; songs: number }[] {
  const counts = new Map<string, number>();
  for (const match of matches) for (const name of new Set(match.track.artists.map((artist) => artist.name))) if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, songs]) => ({ name, songs }));
}

const folded = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();

/** The songs in the member's Liked Songs that other members tagged, with those tags one tap from their own library. */
export function TaggedByOthersSection({ connected, connectionPending = false, onConnectCommunity, store = taggedByOthersStore, preview, previewLoading = false, ...rest }: TaggedByOthersSectionProps) {
  // Disconnecting ends the list: nothing of it is kept in memory or on this computer.
  useEffect(() => {
    if (connected) return;
    forgetTaggedByOthers();
    void store.clear();
    (rest.hiddenStore ?? hiddenSongsStore).clear(null);
  }, [connected, store, rest.hiddenStore]);

  if (connected) return <Results store={store} {...rest} />;
  if (preview && preview.songs.length > 0 && !connectionPending && communitySwitchOn("communityTeasers")) {
    return <Preview preview={preview} inTrackList={!!rest.inTrackList} onConnect={onConnectCommunity} onPlaySong={rest.onPlaySong} />;
  }
  const looking = previewLoading && !connectionPending && communitySwitchOn("communityTeasers");
  return (
    <section className={`${styles.section} ${rest.inTrackList ? styles.inTrackList : ""}`} aria-labelledby="tagged-by-others-title">
      <div className={styles.card}>
        <div className={styles.header}>
          <h3 id="tagged-by-others-title" className={styles.title}>Your songs, tagged by others</h3>
          <p className={styles.lead} role={looking ? "status" : undefined}>
            {connectionPending
              ? "Finish connecting in your browser to see which of your Liked Songs other members already tagged."
              : looking
                ? "Looking for songs in your Liked Songs that other members tagged…"
                : "Create a free Tagify account or sign in to see which of your Liked Songs other members already tagged, and add the tags that fit."}
          </p>
        </div>
        {looking ? null : (
          <button type="button" className={`${styles.action} ${connectStyles.button} ${connectStyles.connect}`} onClick={onConnectCommunity}>{connectionPending ? "Finish connecting" : "Create account or sign in"}</button>
        )}
      </div>
    </section>
  );
}

const previewDetail = (match: CommunityMatch) => {
  const song = match as TaggedByOthersPreviewSong;
  return `Tagged by ${plural(song.people, "member")}${song.peopleCapped ? " or more" : ""}`;
};

/**
 * For people who aren't connected to Community: a taste of how others tagged their songs, without
 * who tagged them, and adding waits until they connect.
 */
function Preview({ preview, inTrackList, onConnect, onPlaySong }: {
  preview: TaggedByOthersPreview;
  inTrackList: boolean;
  onConnect: () => void;
  onPlaySong?: (uri: string) => void;
}) {
  // Most members first, as the connected list starts.
  const songs = useMemo(() => [...preview.songs].sort((a, b) => b.people - a.people), [preview.songs]);
  const total = Math.max(preview.total, songs.length);
  const found = `Other members tagged ${previewFoundText(preview, songs.length)}`;
  // Every song Community described (up to PREVIEW_SONGS_SHOWN), then the invitation to see the rest.
  const usable = songs;
  const more = total - usable.length;
  useEffect(() => recordCommunityTeaserViewed("tab", total), [total]);
  return (
    <section className={`${styles.section} ${inTrackList ? styles.inTrackList : ""}`} aria-labelledby="tagged-by-others-title">
      <div className={styles.card}>
        <div className={styles.titleRow}>
          <h3 id="tagged-by-others-title" className={inTrackList ? styles.visuallyHidden : styles.title}>Your songs, tagged by others</h3>
          <p className={styles.progress}>{found}</p>
        </div>
        <TaggedByOthersRows matches={usable} onToggleTag={async () => {}} coverOf={coverOf} hasTag={() => false} canRemove={false}
          onPlay={onPlaySong ? (match) => onPlaySong(match.track.uri) : undefined}
          detailOf={previewDetail} onConnectToAdd={onConnect} />
        {/* The invitation always closes the preview: to see the rest, or to add these tags. */}
        <LockedSongs matches={songs.slice(usable.length)} total={total} coverOf={coverOf} onShare={onConnect} pitch={null}
          countText={more > 0 ? `${more === 1 ? "1 more song" : `${more.toLocaleString()} more songs`} tagged by others` : "Add these tags to your songs"}
          actionLabel={more > 0 ? `Create account or sign in to see all ${total.toLocaleString()}` : "Create account or sign in"} />
      </div>
    </section>
  );
}

function Results({
  accountId, tracks, taxonomy, onAddMembersTags, onToggleTag, onOpenSong, onLockSong, activeUri, onPlaySong, ratingOf,
  inTrackList = false, sharingLocked = false, onShareTags, check, checkMore, allowance, store, hiddenStore = hiddenSongsStore, now = Date.now,
  listPlaylists = readPlaylistChoices,
}: Omit<TaggedByOthersSectionProps, "connected" | "connectionPending" | "onConnectCommunity">) {
  const { view, checkAgain, checkPlaylists } = useTaggedByOthers(accountId, { check, checkMore, allowance, store, now });
  const allowanceFor = allowance ?? taggedByOthersAllowance;
  const locked = sharingLocked && !!onShareTags;
  // Check again waits CHECK_AGAIN_AFTER_MS after a check finished, shown greyed out with a countdown
  // (Alex, 2026-11-17: "A: countdown, 30 min").
  const [tick, setTick] = useState(0);
  const waitMs = view.phase === "done" && view.checkedAt !== null && !COMMUNITY_FAILED.has(view.stopped) ? view.checkedAt + CHECK_AGAIN_AFTER_MS - now() : 0;
  useEffect(() => {
    if (waitMs <= 0) return;
    // Re-render each time the "Check again in N min" countdown drops a minute, and when it ends.
    const untilNextMinute = waitMs - (Math.ceil(waitMs / 60_000) - 1) * 60_000;
    const timer = setTimeout(() => setTick((current) => current + 1), Math.min(untilNextMinute + 50, 2 ** 31 - 1));
    return () => clearTimeout(timer);
  }, [waitMs, tick]);
  const [shown, setShown] = useState(ROWS_PER_STEP);
  const [search, setSearch] = useState("");
  const [picking, setPicking] = useState(false);
  const [chosenPlaylists, setChosenPlaylists] = useState<string[]>(() => loadPlaylistChoice(accountId));
  useEffect(() => { setChosenPlaylists(loadPlaylistChoice(accountId)); }, [accountId]);
  const [choices, setChoices] = useState<ViewChoices>(() => loadChoices(accountId));
  useEffect(() => { setChoices(loadChoices(accountId)); }, [accountId]);
  const choose = (next: Partial<ViewChoices>) => {
    setChoices((current) => { const merged = { ...current, ...next }; saveChoices(accountId, merged); return merged; });
    setShown(ROWS_PER_STEP);
  };
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [artistFilter, setArtistFilter] = useState<string | null>(null);
  const [allTagNames, setAllTagNames] = useState(false);
  // Songs tagged or opened here stay in view while "Not tagged by me yet" is on, so a tag just added can be taken off again.
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const touch = useCallback((uri: string) => setTouched((current) => (current.has(uri) ? current : new Set([...current, uri]))), []);

  // Hidden songs, per account on this computer.
  const [hidden, setHidden] = useState<readonly string[]>(() => (accountId ? hiddenStore.load(accountId) : []));
  useEffect(() => { setHidden(accountId ? hiddenStore.load(accountId) : []); }, [accountId, hiddenStore]);
  const [showHidden, setShowHidden] = useState(false);
  const [lastHidden, setLastHidden] = useState<CommunityMatch | null>(null);
  const setHiddenSongs = (next: readonly string[]) => {
    setHidden(next);
    if (accountId) hiddenStore.save(accountId, next);
  };
  const hide = (match: CommunityMatch) => {
    setHiddenSongs([...hidden.filter((uri) => uri !== match.track.uri), match.track.uri]);
    setLastHidden(match);
    recordProductInteraction("tagged_by_others_song_hidden", { hide_action: "hidden" });
  };
  const unhide = (uri: string) => {
    setHiddenSongs(hidden.filter((item) => item !== uri));
    setLastHidden((current) => (current?.track.uri === uri ? null : current));
    recordProductInteraction("tagged_by_others_song_hidden", { hide_action: "unhidden" });
  };
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  // Hiding and "Not tagged by me yet" belong to the track list's view, where tags also come off again.
  const editable = !!onToggleTag;
  const notTaggedOnly = editable && choices.notTaggedOnly;

  const hasTag = useCallback((match: CommunityMatch, tag: MergedTag | CommunityMatchTag) => {
    const spellings = "spellings" in tag ? tag.spellings : [tag.label];
    return (tracks[match.track.uri]?.tagIds ?? []).some((id) => spellings.some((label) => isSameTagName(taxonomy.tagsById[id]?.name ?? "", label)));
  }, [tracks, taxonomy]);
  const toggleTag = useCallback(async (match: CommunityMatch, tag: MergedTag, on: boolean) => {
    touch(match.track.uri);
    if (onToggleTag) await onToggleTag(match, tag, on);
    else if (on) await onAddMembersTags(match, [{ label: tag.label, paths: tag.paths, people: tag.people }]);
    else return;
    if (on) recordProductInteraction("community_library_tag_added", { members_add: "tag" });
    if (onToggleTag) recordProductInteraction("tagged_by_others_tag_toggled", { toggle_action: on ? "added" : "removed" });
  }, [onAddMembersTags, onToggleTag, touch]);
  const lock = onLockSong ? (match: CommunityMatch) => { touch(match.track.uri); onLockSong(match); }
    : onOpenSong ? (match: CommunityMatch) => onOpenSong(match.track.uri) : undefined;

  const { phase, scope, checked, matches, stopped, playlistsRead, playlists, skippedPlaylists, capped, checkedAt, playlistIds, playlistsLeft } = view;
  const likedOnly = scope === "liked";
  const checking = phase === "checking";
  const found = matches.length;
  const query = folded(search.trim());
  const visibleMatches = useMemo(() => (onToggleTag ? matches.filter((match) => !hiddenSet.has(match.track.uri)) : matches), [matches, hiddenSet, onToggleTag]);
  const tagNames = useMemo(() => topTagNames(visibleMatches), [visibleMatches]);
  const artists = useMemo(() => topArtists(visibleMatches), [visibleMatches]);
  const listed = useMemo(() => {
    const kept = visibleMatches.filter((match) =>
      (!query || folded(match.track.name).includes(query) || match.track.artists.some((artist) => folded(artist.name).includes(query)))
      && (!notTaggedOnly || touched.has(match.track.uri) || !(tracks[match.track.uri]?.tagIds?.length))
      && (!tagFilter || match.tags.some((tag) => isSameTagName(tag.label, tagFilter)))
      && (!artistFilter || match.track.artists.some((artist) => artist.name === artistFilter)));
    // Songs most members tagged first, or the ones added to Spotify most recently (songs without a
    // date, from checks saved before dates were kept, go last); ties keep the order Spotify lists them in.
    return kept.sort((a, b) => (choices.sort === "members" ? b.people - a.people : (b.track.addedAt ?? 0) - (a.track.addedAt ?? 0))
      || a.position - b.position);
  }, [visibleMatches, query, choices.sort, notTaggedOnly, touched, tracks, tagFilter, artistFilter]);
  const hiddenMatches = useMemo(() => matches.filter((match) => hiddenSet.has(match.track.uri)), [matches, hiddenSet]);
  const filtering = !!query || !!tagFilter || !!artistFilter || notTaggedOnly;
  const clearFilters = () => { setSearch(""); setTagFilter(null); setArtistFilter(null); choose({ notTaggedOnly: false }); };

  const sectionClass = `${styles.section} ${inTrackList ? styles.inTrackList : ""}`;
  const titleClass = inTrackList ? styles.visuallyHidden : styles.title;
  if (phase === "loading") {
    return (
      <section className={sectionClass} aria-labelledby="tagged-by-others-title">
        <div className={styles.card}>
          <h3 id="tagged-by-others-title" className={titleClass}>Your songs, tagged by others</h3>
        </div>
      </section>
    );
  }

  const lead = checking ? (view.checking !== "playlists" && playlists === null ? "Checking your Liked Songs…"
      : playlists !== null && playlistsRead < playlists ? `Checking your playlists… ${playlistsRead.toLocaleString()} of ${playlists.toLocaleString()}`
      : "Checking your playlists…")
    // The list speaks for itself; a tag's + says what it does.
    : found > 0 ? null
    : stopped ? null
    : checked > 0 ? (likedOnly ? "No other members have tagged your Liked Songs yet." : "No other members have tagged your songs yet.")
    : likedOnly ? "You have no Liked Songs to check yet. Like a few songs in Spotify, then come back."
    : "You have no songs to check yet. Like a few songs or add some to a playlist in Spotify, then come back.";

  // Playlists are an opt-in after Liked Songs: "Choose playlists" once Liked Songs was checked all the
  // way, listing only playlists the member made; then the rest of their choice a batch at a time. Not
  // after Community failed. Locked, playlists aren't read: they'd find songs the member can't open yet.
  const playlistsOffered = !checking && !COMMUNITY_FAILED.has(stopped) && !locked && (!likedOnly || stopped === null);
  const remainingAction = playlistsOffered && !likedOnly && playlistIds.length > 0 && (playlistsLeft ?? 0) > 0
    ? `Check the remaining ${plural(playlistsLeft ?? 0, "playlist")}` : null;

  // Locked, the top songs (most members first) are usable and the rest wait until the member shares their tags.
  const usable = locked ? listed.slice(0, USABLE_BEFORE_SHARING) : listed.slice(0, shown);
  const shownTagNames = allTagNames ? tagNames : tagNames.slice(0, TAG_NAMES_SHOWN);
  const setNotTaggedOnly = (on: boolean) => { choose({ notTaggedOnly: on }); recordProductInteraction("tagged_by_others_filter_used", { filter_kind: "not_tagged" }); };
  return (
    <section className={sectionClass} aria-labelledby="tagged-by-others-title">
      <div className={styles.card}>
        <div className={styles.titleRow}>
          <h3 id="tagged-by-others-title" className={titleClass}>Your songs, tagged by others</h3>
          {inTrackList && (checking || checked > 0) ? <p className={styles.progress} role="status">{checkedSummary(view, checking)}</p> : null}
          {checking ? null : view.refreshing ? (
            <span className={styles.checked} role="status">Checking for new tags…</span>
          ) : (
            <span className={styles.checked}>
              {checkedAt !== null ? <span>Checked {checkedWhen(checkedAt, now())}</span> : null}
              {waitMs > 0 ? (
                <button type="button" className={styles.checkAgain} disabled title="Tagify waits a little between checks so Spotify keeps running smoothly">
                  <RefreshCw size={13} aria-hidden="true" />
                  <span className={styles.buttonLabel}>Check again in {Math.ceil(waitMs / 60_000)} min</span>
                </button>
              ) : (
                <button type="button" className={styles.checkAgain} title="Check again" onClick={() => { setShown(ROWS_PER_STEP); checkAgain(); }}>
                  <RefreshCw size={13} aria-hidden="true" />
                  <span className={styles.buttonLabel}>Check again</span>
                </button>
              )}
            </span>
          )}
        </div>
        {lead ? <p className={styles.lead}>{lead}</p> : null}
        {!inTrackList && (checking || checked > 0)
          ? <p className={styles.progress} role="status">{checkedSummary(view, checking)}</p>
          : null}
        {stopped ? <p className={styles.notice} role="status">{STOP_COPY[stopped]}</p> : null}
        {!checking && capped ? (
          <p className={styles.notice} role="status">
            {likedOnly ? "You have more Liked Songs" : "Your library has more songs"} than Tagify checks at once, so only the first {LISTS_MAX_SONGS.toLocaleString()} were checked.
          </p>
        ) : null}
        {!checking && skippedPlaylists > 0 ? (
          <p className={styles.notice} role="status">
            {skippedPlaylists === 1
              ? "Spotify couldn't open 1 playlist, so its songs weren't checked."
              : `Spotify couldn't open ${skippedPlaylists.toLocaleString()} playlists, so their songs weren't checked.`}
          </p>
        ) : null}
        {playlistsOffered ? (
          <div className={styles.playlistsRow}>
            <button type="button" className={styles.checkAgain} onClick={() => setPicking(true)}>
              <ListMusic size={13} aria-hidden="true" />
              {likedOnly ? "Also check playlists I made…" : "Choose playlists…"}
            </button>
            {remainingAction ? (
              <button type="button" className={styles.checkAgain} onClick={() => checkPlaylists(chosenPlaylists)}>
                {remainingAction}
              </button>
            ) : null}
          </div>
        ) : null}
        {picking && accountId ? (
          <PlaylistPicker load={() => listPlaylists(allowanceFor(accountId))} initial={chosenPlaylists} checked={playlistIds}
            onClose={() => setPicking(false)}
            onCheck={(chosen, foldersUsed) => { recordProductInteraction("tagged_by_others_playlists_chosen", { playlists_chosen: playlistsChosenBucket(chosen.length), folders_used: foldersUsed ? "yes" : "no" }); setPicking(false); setChosenPlaylists(chosen); savePlaylistChoice(accountId, chosen); setShown(ROWS_PER_STEP); checkPlaylists(chosen); }} />
        ) : null}
        {found >= CONTROLS_FROM && !locked ? (
          <div className={styles.filters}>
            <div className={styles.controls}>
              <input type="search" className={styles.search} value={search} placeholder="Search songs or artists" aria-label="Search songs or artists"
                onChange={(event) => { setSearch(event.target.value); setShown(ROWS_PER_STEP); }} />
              {artists.length > 1 ? (
                <select className={styles.sort} value={artistFilter ?? ""} aria-label="Filter by artist"
                  onChange={(event) => { setArtistFilter(event.target.value || null); setShown(ROWS_PER_STEP); if (event.target.value) recordProductInteraction("tagged_by_others_filter_used", { filter_kind: "artist" }); }}>
                  <option value="">All artists</option>
                  {artists.map(({ name, songs }) => <option key={name} value={name}>{name} ({songs.toLocaleString()})</option>)}
                </select>
              ) : null}
              <select className={styles.sort} value={choices.sort} aria-label="Sort songs" onChange={(event) => choose({ sort: event.target.value as Sort })}>
                <option value="members">Most members first</option>
                <option value="recent">Recently added</option>
              </select>
            </div>
            {tagNames.length > 1 || editable ? (
              <div className={styles.tagFilters} role="group" aria-label="Show songs others tagged">
                {editable ? (
                  <>
                    <button type="button" className={`${styles.tagFilter} ${choices.notTaggedOnly ? styles.tagFilterOn : ""}`} aria-pressed={choices.notTaggedOnly}
                      onClick={() => setNotTaggedOnly(!choices.notTaggedOnly)}>
                      {choices.notTaggedOnly ? <Check size={13} strokeWidth={2.5} aria-hidden="true" /> : null}Not tagged by me yet
                    </button>
                    {tagNames.length > 1 ? <span className={styles.chipDivider} aria-hidden="true" /> : null}
                  </>
                ) : null}
                {(tagNames.length > 1 ? shownTagNames : []).map(({ label, songs }) => {
                  const selected = !!tagFilter && isSameTagName(tagFilter, label);
                  return (
                    <button key={label} type="button" className={`${styles.tagFilter} ${selected ? styles.tagFilterOn : ""}`} aria-pressed={selected}
                      onClick={() => { setTagFilter(selected ? null : label); setShown(ROWS_PER_STEP); if (!selected) recordProductInteraction("tagged_by_others_filter_used", { filter_kind: "tag" }); }}>
                      {label}<span className={styles.tagFilterCount}>{songs.toLocaleString()}</span>
                    </button>
                  );
                })}
                {tagNames.length > TAG_NAMES_SHOWN ? (
                  <button type="button" className={styles.tagFilterMore} aria-expanded={allTagNames} onClick={() => setAllTagNames((current) => !current)}>
                    {allTagNames ? "Fewer" : `+${(tagNames.length - TAG_NAMES_SHOWN).toLocaleString()} more`}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {lastHidden ? (
          <p className={styles.undoBar} role="status">
            <span>Hid “{lastHidden.track.name}”.</span>
            <button type="button" className={styles.linkButton} onClick={() => unhide(lastHidden.track.uri)}>Undo</button>
            <button type="button" className={styles.dismiss} aria-label="Close" onClick={() => setLastHidden(null)}>×</button>
          </p>
        ) : null}
        {listed.length > 0 ? (
          <TaggedByOthersRows matches={usable} onToggleTag={toggleTag} coverOf={coverOf} hasTag={hasTag} canRemove={!!onToggleTag}
            onLock={lock} activeUri={activeUri ?? null} ratingOf={ratingOf ? (match) => ratingOf(match.track.uri) : undefined}
            onPlay={onPlaySong ? (match) => { onPlaySong(match.track.uri); recordProductInteraction("tagged_by_others_song_played"); } : undefined}
            onHide={locked || !editable ? undefined : hide}
            detailOf={(match) => taggedByText(match as TaggedByOthersMatch)} />
        ) : visibleMatches.length > 0 && filtering ? (
          <p className={styles.lead} role="status">
            No songs match these filters.{" "}
            <button type="button" className={styles.linkButton} onClick={clearFilters}>Show all songs</button>
          </p>
        ) : found > 0 && !visibleMatches.length ? <p className={styles.lead} role="status">You hid every song here.</p> : null}
        {locked ? <LockedSongs matches={listed.slice(USABLE_BEFORE_SHARING)} total={found} coverOf={coverOf} onShare={onShareTags!} /> : null}
        {!locked && listed.length > shown ? (
          <button type="button" className={styles.more} onClick={() => setShown((current) => current + ROWS_PER_STEP)}>Show more</button>
        ) : null}
        {!locked && editable && hiddenMatches.length > 0 ? (
          <div className={styles.hiddenSongs}>
            <button type="button" className={styles.linkButton} aria-expanded={showHidden} onClick={() => setShowHidden((current) => !current)}>
              {showHidden ? "Hide the songs you hid" : `Hidden (${hiddenMatches.length.toLocaleString()})`}
            </button>
            {showHidden ? (
              <ul className={styles.hiddenList}>
                {hiddenMatches.map((match) => (
                  <li key={match.track.uri} className={styles.hiddenRow}>
                    <span className={styles.hiddenName}>{match.track.name} <span className={styles.hiddenArtist}>· {match.track.artists.map((artist) => artist.name).join(", ")}</span></span>
                    <button type="button" className={styles.linkButton} onClick={() => unhide(match.track.uri)} aria-label={`Show ${match.track.name} again`}>Show again</button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

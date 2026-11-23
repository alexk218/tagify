import { useCallback, useEffect, useRef, useState } from "react";
import { spotifyService } from "@/services/SpotifyService";
import { searchCommunityTags, TagSearchError, type TagSearchFailure, type TagSearchLock, type TagSearchMatch, type TagSearchPage, type TagSearchSong } from "./tagSearchClient";

/** Typing or ticking filters settles for this long before Community is asked. */
export const SEARCH_SETTLE_MS = 400;
/** Answers reused while Spotify stays open, so flipping between filters doesn't ask again. */
const KEPT_MS = 10 * 60_000;
const KEPT_SEARCHES = 30;

export interface CommunityTagSearchState {
  phase: "idle" | "loading" | "done" | "failed";
  songs: TagSearchSong[];
  total: number;
  /** Community stopped counting: there are at least `total`. */
  capped: boolean;
  locked: TagSearchLock | null;
  failure: TagSearchFailure | null;
  /** More pages wait (members who share their tags only). */
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
}

type Search = (tags: readonly string[], options: { match: TagSearchMatch; cursor?: string | null; signal?: AbortSignal }) => Promise<TagSearchPage>;
/** Names for songs Community had none for, from Spotify. */
type NameSongs = (songs: TagSearchSong[], signal?: AbortSignal) => Promise<TagSearchSong[]>;

const kept = new Map<string, { at: number; page: TagSearchPage }>();

/** Forgets every kept answer, for example once the member connects or starts sharing. */
export function forgetCommunityTagSearches() {
  kept.clear();
}

export const searchKey = (tags: readonly string[], match: TagSearchMatch, viewer: string) =>
  JSON.stringify([viewer, match, [...tags].map((tag) => tag.toLowerCase()).sort()]);

const nameFromSpotify: NameSongs = async (songs, signal) => {
  const missing = songs.filter((song) => !song.title).map((song) => song.uri);
  if (!missing.length) return songs;
  const found = await spotifyService.getBatchTracks(missing, 2, signal).catch(() => ({}));
  return songs.map((song) => {
    const info = (found as Record<string, { name: string; artistsData: { name: string }[]; albumImageUrl: string | null }>)[song.uri];
    return song.title || !info ? song : { ...song, title: info.name, artists: info.artistsData.map((artist) => artist.name), imageUrl: song.imageUrl ?? info.albumImageUrl };
  });
};

interface SearchState {
  phase: CommunityTagSearchState["phase"];
  songs: TagSearchSong[];
  total: number;
  capped: boolean;
  locked: TagSearchLock | null;
  failure: TagSearchFailure | null;
  nextCursor: string | null;
}

const IDLE: SearchState = { phase: "idle", songs: [], total: 0, capped: false, locked: null, failure: null, nextCursor: null };

/**
 * Songs on Community tagged with the track list's active tags. `viewer` changes whenever who is asking
 * changes (connected, sharing), so the answer is asked again with the right limit.
 */
export function useCommunityTagSearch({ tags, match, enabled, viewer, search = (t, o) => searchCommunityTags(t, o), nameSongs = nameFromSpotify, settleMs = SEARCH_SETTLE_MS }: {
  tags: readonly string[];
  match: TagSearchMatch;
  enabled: boolean;
  viewer: string;
  search?: Search;
  nameSongs?: NameSongs;
  settleMs?: number;
}): CommunityTagSearchState {
  const [state, setState] = useState<SearchState>(IDLE);
  const [loadingMore, setLoadingMore] = useState(false);
  const key = enabled && tags.length ? searchKey(tags, match, viewer) : null;
  const current = useRef<{ key: string | null; controller: AbortController | null }>({ key: null, controller: null });
  const searchRef = useRef(search);
  searchRef.current = search;
  const nameRef = useRef(nameSongs);
  nameRef.current = nameSongs;
  const tagsRef = useRef(tags);
  tagsRef.current = tags;

  useEffect(() => {
    current.current.controller?.abort();
    current.current = { key, controller: null };
    setLoadingMore(false);
    if (!key) { setState(IDLE); return; }
    const saved = kept.get(key);
    if (saved && Date.now() - saved.at < KEPT_MS) {
      setState({ phase: "done", ...saved.page, failure: null });
      return;
    }
    setState((previous) => ({ ...previous, phase: "loading", failure: null }));
    const controller = new AbortController();
    current.current.controller = controller;
    const timer = setTimeout(async () => {
      try {
        const page = await searchRef.current(tagsRef.current, { match, signal: controller.signal });
        const songs = await nameRef.current(page.songs, controller.signal);
        if (controller.signal.aborted) return;
        const named = { ...page, songs };
        kept.set(key, { at: Date.now(), page: named });
        if (kept.size > KEPT_SEARCHES) kept.delete(kept.keys().next().value!);
        setState({ phase: "done", ...named, failure: null });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({ ...IDLE, phase: "failed", failure: error instanceof TagSearchError ? error.reason : "unreachable" });
      }
    }, settleMs);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key, match, settleMs]);

  const loadMore = useCallback(() => {
    if (state.phase !== "done" || !state.nextCursor || loadingMore || !key) return;
    const askedFor = key;
    const controller = new AbortController();
    current.current.controller = controller;
    setLoadingMore(true);
    void (async () => {
      try {
        const page = await searchRef.current(tagsRef.current, { match, cursor: state.nextCursor, signal: controller.signal });
        const songs = await nameRef.current(page.songs, controller.signal);
        if (controller.signal.aborted || current.current.key !== askedFor) return;
        setState((previous) => {
          const known = new Set(previous.songs.map((song) => song.uri));
          const merged = { ...previous, songs: [...previous.songs, ...songs.filter((song) => !known.has(song.uri))], total: Math.max(previous.total, page.total), capped: page.capped, nextCursor: page.nextCursor };
          kept.set(askedFor, { at: Date.now(), page: { songs: merged.songs, total: merged.total, capped: page.capped, locked: merged.locked, nextCursor: merged.nextCursor } });
          return merged;
        });
      } catch {
        // The songs already shown stay; "Show more" can be tried again.
      } finally {
        if (current.current.key === askedFor) setLoadingMore(false);
      }
    })();
  }, [state, loadingMore, key, match]);

  return {
    phase: state.phase,
    songs: state.songs,
    total: state.total,
    capped: state.capped,
    locked: state.locked,
    failure: state.failure,
    hasMore: state.phase === "done" && !!state.nextCursor,
    loadingMore,
    loadMore,
  };
}

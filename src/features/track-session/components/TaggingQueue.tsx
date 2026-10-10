import React, { useEffect, useMemo, useRef, useState } from "react";
import type { SpotifyTrack } from "@/types/SpotifyTypes";
import type { TagTaxonomy, TrackData } from "@/types/tagData";
import { collectTagIdsForCategory } from "@/utils/tagTaxonomy";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { matchesQueueGap, type QueueGap } from "../utils/taggingQueue.logic";
import styles from "./TaggingQueue.module.css";

export function TaggingQueue({ tracks, taxonomy, onTagTrack, onTagTracks, disabled = false }: {
  tracks: Record<string, TrackData>; taxonomy: TagTaxonomy;
  onTagTrack: (uri: string) => void; onTagTracks: (tracks: SpotifyTrack[]) => void; disabled?: boolean;
}) {
  const [source, setSource] = useState("liked");
  const [playlistLink, setPlaylistLink] = useState("");
  const [gap, setGap] = useState<QueueGap>("tags");
  const [category, setCategory] = useState("");
  const [library, setLibrary] = useState<SpotifyTrack[]>([]);
  const [checked, setChecked] = useState(0);
  const [unavailable, setUnavailable] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(0);
  const [total, setTotal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const request = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const running = useRef(false);
  const categoryId = taxonomy.categoriesById[category] ? category : taxonomy.categoryOrder[0] || "";
  const categoryTags = useMemo(() => new Set(categoryId ? collectTagIdsForCategory(taxonomy, categoryId) : []), [categoryId, taxonomy]);
  const remaining = useMemo(() => library.filter((track) => matchesQueueGap(tracks[track.uri], gap, categoryTags)), [library, tracks, gap, categoryTags]);
  const selectedTracks = remaining.filter((track) => selected.includes(track.uri));
  const pageIndex = Math.min(page, Math.max(0, Math.ceil(remaining.length / 20) - 1));
  const visible = remaining.slice(pageIndex * 20, (pageIndex + 1) * 20);

  const stop = () => { request.current++; controller.current?.abort(); running.current = false; setBusy(false); };
  useEffect(() => () => { request.current++; controller.current?.abort(); }, []);
  const reset = () => {
    stop(); setLibrary([]); setChecked(0); setUnavailable(0); setNextOffset(0); setTotal(null); setSelected([]); setPage(0); setError("");
  };
  const load = async (all = false, restart = false) => {
    if (running.current || (!restart && nextOffset === null)) return;
    let playlistId: string | null = null;
    if (source === "playlist") {
      const match = playlistLink.trim().match(/(?:spotify:playlist:|https:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?playlist\/)([A-Za-z0-9]{22})(?:[/?#]|$)/);
      if (!match) { setError("Paste a Spotify playlist link, then try again."); return; }
      playlistId = match[1];
    }
    const revision = ++request.current;
    controller.current = new AbortController();
    const signal = controller.current.signal;
    running.current = true; setBusy(true); setError("");
    let offset: number | null = restart ? 0 : nextOffset;
    let count = restart ? 0 : checked;
    let skipped = restart ? 0 : unavailable;
    const collected = new Map((restart ? [] : library).map((track) => [track.uri, track]));
    try {
      do {
        let result = await spotifyApiService.getTaggingQueuePage(playlistId, offset!, signal);
        if (revision !== request.current || signal.aborted) return;
        if (result.backend === "desktop" && offset! > 0 && result.tracks.length && result.tracks.every((track) => collected.has(track.uri))) {
          // Some desktop versions ignore offset. The Web API also distinguishes
          // repeated tracks in a playlist from a repeated first page.
          result = await spotifyApiService.getTaggingQueuePage(playlistId, offset!, signal, true);
          if (revision !== request.current || signal.aborted) return;
        }
        result.tracks.forEach((track) => collected.set(track.uri, track));
        count += result.checked; skipped += result.unavailable;
        if (restart) { setSelected([]); setPage(0); }
        setLibrary([...collected.values()]); setChecked(count); setUnavailable(skipped); setTotal(result.total);
        offset = result.nextOffset; setNextOffset(offset);
      } while (all && offset !== null && !signal.aborted);
    } catch (error) {
      if (revision === request.current && !signal.aborted) setError(error instanceof Error ? error.message : "Spotify couldn't check more tracks. Your progress is kept; please try again.");
    } finally {
      if (revision === request.current) { running.current = false; setBusy(false); }
    }
  };
  return <details className={styles.queue}>
    <summary>Tagging queue</summary>
    <p>Find tracks that still need tags, ratings, or energy. Completed tracks leave the queue as you tag them.</p>
    <div className={styles.controls}>
      <label>Check <select value={source} onChange={(event) => { reset(); setSource(event.target.value); }} disabled={busy} aria-label="Queue source">
        <option value="liked">Liked Songs</option><option value="playlist">A playlist</option>
      </select></label>
      {source === "playlist" && <input aria-label="Spotify playlist link" placeholder="Paste a Spotify playlist link" value={playlistLink} disabled={busy} onChange={(event) => { reset(); setPlaylistLink(event.target.value); }} />}
      <label>Show <select value={gap} onChange={(event) => { setGap(event.target.value as QueueGap); setPage(0); }} aria-label="Missing fields">
        <option value="tags">No tags</option><option value="untagged">Not tagged or rated</option><option value="rating">No rating</option><option value="energy">No energy</option><option value="incomplete">Any incomplete tagging</option>
        <option value="category" disabled={!taxonomy.categoryOrder.length}>Missing a category</option>
      </select></label>
      {gap === "category" && <select aria-label="Required category" value={categoryId} onChange={(event) => setCategory(event.target.value)}>
        {taxonomy.categoryOrder.map((id) => <option key={id} value={id}>{taxonomy.categoriesById[id]?.name}</option>)}
      </select>}
      <button disabled={busy || nextOffset === null} onClick={() => void load()}>{checked ? "Check next 50" : "Check first 50"}</button>
      <button disabled={busy || nextOffset === null} onClick={() => void load(true)}>Check all tracks</button>
      {busy ? <button onClick={stop}>Stop checking</button> : checked > 0 && <button onClick={() => void load(false, true)}>Refresh queue</button>}
    </div>
    {error && <p role="alert">{error}</p>}
    {(checked > 0 || busy || nextOffset === null) && <p role="status">{remaining.length} needing attention · {checked}{total !== null ? ` of ${total}` : ""} checked{busy ? " · Checking…" : nextOffset !== null ? " · More tracks to check" : " · Library checked"}{unavailable ? ` · ${unavailable} unavailable or non-music items skipped` : ""}</p>}
    {remaining.length > 0 && <div className={styles.controls}>
      <button disabled={disabled} onClick={() => onTagTrack(remaining[0].uri)}>Tag next track</button>
      <button disabled={disabled || !selectedTracks.length} onClick={() => onTagTracks(selectedTracks)}>Tag selected ({selectedTracks.length})</button>
      <button disabled={disabled} onClick={() => setSelected((old) => [...new Set([...old, ...visible.map((track) => track.uri)])])}>Select this page</button>
      {selectedTracks.length > 0 && <button onClick={() => setSelected([])}>Clear selection</button>}
    </div>}
    <ul className={styles.list}>
      {visible.map((track) => <li key={track.uri}>
        <label><input type="checkbox" aria-label={`Select ${track.name}`} checked={selected.includes(track.uri)} disabled={disabled} onChange={(event) => setSelected((old) => event.target.checked ? [...old, track.uri] : old.filter((id) => id !== track.uri))} /><span><strong>{track.name === "Unavailable track" ? tracks[track.uri]?.name || track.name : track.name}</strong><small>{track.artists.map((artist) => artist.name).join(", ") || tracks[track.uri]?.artists || "Unknown artist"}</small></span></label>
        <button disabled={disabled} onClick={() => onTagTrack(track.uri)} aria-label={`Tag ${track.name}`}>Tag</button>
      </li>)}
    </ul>
    {remaining.length > 20 && <div className={styles.controls}><button disabled={!pageIndex} onClick={() => setPage(pageIndex - 1)}>Previous page</button><span>Page {pageIndex + 1} of {Math.ceil(remaining.length / 20)}</span><button disabled={(pageIndex + 1) * 20 >= remaining.length} onClick={() => setPage(pageIndex + 1)}>Next page</button></div>}
  </details>;
}

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Portal } from "@/components/ui";
import { storageService } from "@/services/storage/StorageService";
import { smartPlaylistSyncService } from "@/services/SmartPlaylistSyncService";
import type { TagDataStructure } from "@/types/tagData";
import { findDisplayTagName } from "@/utils/tagTaxonomy";
import { evaluateTagFilterFormula, flattenTagFilterFormula, flattenExcludedTagFilterFormula, formatTagFilterFormula } from "@/utils/tagFilterGroups";
import { smartPlaylistTagChoices, type TagChoice } from "../utils/smartPlaylist.tagChoices";
import { loadSmartPlaylistsFromStorage } from "../utils/smartPlaylist.storage";
import styles from "./SmartPlaylistTagChoices.module.css";

export default function SmartPlaylistTagChoices({ enabled }: { enabled: boolean }) {
  const [data, setData] = useState<TagDataStructure | null>(null);
  const [unblocked, setUnblocked] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [manualTags, setManualTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  const focusDialog = useCallback((node: HTMLDivElement | null) => { dialog.current = node; node?.focus(); }, []);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const load = () => { void (async () => {
      const playlists = await loadSmartPlaylistsFromStorage();
      if (!playlists.some((playlist) => playlist.isActive && playlist.pendingTagChoices?.length)) { if (active) setData(null); return; }
      const next = await storageService.loadAllStrict();
      if (active) setData(next);
    })().catch(() => { /* Sync retries when storage recovers. */ }); };
    load();
    window.addEventListener("tagify:smartPlaylistsUpdated", load);
    window.addEventListener("tagify:durableStateRestored", load);
    window.addEventListener("tagify:dataUpdated", load);
    return () => {
      active = false;
      window.removeEventListener("tagify:smartPlaylistsUpdated", load);
      window.removeEventListener("tagify:durableStateRestored", load);
      window.removeEventListener("tagify:dataUpdated", load);
    };
  }, [enabled]);
  const pending = (data?.smartPlaylists ?? []).flatMap((playlist) => playlist.isActive
    ? (playlist.pendingTagChoices ?? []).map((uri) => ({ playlist, uri })) : []);
  const current = pending[0];
  const key = current ? `${current.playlist.id}:${current.uri}:${JSON.stringify(current.playlist.criteria)}` : "";
  useEffect(() => { setSelected(null); setManualTags(current ? data?.tracks[current.uri]?.tagIds ?? [] : []); setError(""); }, [key]);
  const waiting = enabled && !dismissed && Boolean(current);
  useEffect(() => {
    if (!waiting) { setUnblocked(false); return; }
    const check = () => {
      const other = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], .GenericModal, .tagify-portal > *'))
        .some((node) => !node.contains(dialog.current) && !dialog.current?.contains(node));
      setUnblocked(!other && document.visibilityState === "visible");
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("visibilitychange", check);
    check();
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", check); };
  }, [waiting]);
  const visible = waiting && unblocked;
  useEffect(() => {
    if (!visible) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, [visible]);
  if (!visible || !current || !data) return null;
  const { playlist, uri } = current;
  const track = data.tracks[uri];
  const existingTags = track?.tagIds ?? [];
  const choices = smartPlaylistTagChoices(existingTags, playlist.criteria);
  const formula = { clauses: playlist.criteria.includeTagClauses, connectors: playlist.criteria.clauseConnectors };
  const name = (id: string) => data.taxonomy.tagsById[id] ? findDisplayTagName(data.taxonomy, id, { disambiguate: true }) : "Unavailable tag";
  const manualChoice = { add: manualTags.filter((id) => !existingTags.includes(id)), remove: existingTags.filter((id) => !manualTags.includes(id)) };
  const choice: TagChoice | null = choices ? (selected === null ? null : choices[selected]) : manualChoice;
  const canSave = Boolean(choice) && (choices !== null || evaluateTagFilterFormula(manualTags, formula));
  const save = async () => {
    if (!choice || busy) return;
    setBusy(true); setError("");
    try {
      await smartPlaylistSyncService.resolveTagChoice(playlist.playlistId, uri, choice);
      setData(await storageService.loadAllStrict());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your choice could not be saved. Please try again.");
    } finally { setBusy(false); }
  };
  return <Portal><div className={styles.overlay}>
    <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="smart-tag-choice-title" tabIndex={-1} ref={focusDialog}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" && !busy) setDismissed(true);
        if (event.key !== "Tab") return;
        const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])') ?? []);
        const first = controls[0]; const last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      <span className={styles.eyebrow}>Smart playlists · {pending.length} {pending.length === 1 ? "choice" : "choices"} waiting</span>
      <h2 id="smart-tag-choice-title">How would you like to tag this song?</h2>
      <p className={styles.track}>{track?.name || "Song added to your playlist"}{track?.artists ? <span>{track.artists}</span> : null}</p>
      <p>You added this song to <strong>{playlist.playlistName}</strong>. Its filters allow more than one tag choice.</p>
      <p className={styles.formula}>{formatTagFilterFormula(formula, name)}</p>
      <fieldset disabled={busy} className={styles.options}><legend>Choose the tags that fit</legend>
        {choices ? choices.map((option, index) => <label key={index} className={styles.option}>
          <input type="radio" name="smart-playlist-tag-choice" checked={selected === index} onChange={() => setSelected(index)} />
          <span>{[option.add.length ? `Add ${option.add.map(name).join(" + ")}` : "", option.remove.length ? `Remove ${option.remove.map(name).join(" + ")}` : ""].filter(Boolean).join("; ") || "Keep the current tags"}</span>
        </label>) : [...new Set([...existingTags, ...flattenTagFilterFormula(formula), ...flattenExcludedTagFilterFormula(formula)])].map((id) => <label key={id} className={styles.option}>
          <input type="checkbox" checked={manualTags.includes(id)} onChange={(event) => setManualTags((tags) => event.target.checked ? [...tags, id] : tags.filter((tag) => tag !== id))} />{name(id)}
        </label>)}
      </fieldset>
      <p className={styles.help}>The song stays in this playlist while you decide.</p>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      <div className={styles.actions}><button disabled={busy} onClick={() => setDismissed(true)}>Later</button><button className={styles.primary} disabled={!canSave || busy} onClick={() => void save()}>{busy ? "Saving…" : "Save tags"}</button></div>
    </div>
  </div></Portal>;
}

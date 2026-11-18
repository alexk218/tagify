import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Folder, ListMusic } from "lucide-react";
import { Portal } from "@/components/ui";
import type { RootlistCatalogPlaylist } from "@/services/SpotifyApiService";
import { playlistReads } from "./taggedByOthersScan";
import styles from "./PlaylistPicker.module.css";

interface FolderNode { id: string; name: string; folders: FolderNode[]; playlists: RootlistCatalogPlaylist[] }

/** The member's own playlists as Spotify's folder tree; folders with none of them left out. */
export function playlistTree(playlists: readonly RootlistCatalogPlaylist[]): FolderNode {
  const root: FolderNode = { id: "", name: "", folders: [], playlists: [] };
  for (const playlist of playlists) {
    let node = root;
    for (const folder of playlist.folders ?? []) {
      let child = node.folders.find((item) => item.id === folder.id);
      if (!child) { child = { id: folder.id, name: folder.name, folders: [], playlists: [] }; node.folders.push(child); }
      node = child;
    }
    node.playlists.push(playlist);
  }
  return root;
}

const idsIn = (node: FolderNode): string[] => [...node.playlists.map((playlist) => playlist.playlistId), ...node.folders.flatMap(idsIn)];
const plural = (count: number, word: string) => `${count.toLocaleString()} ${count === 1 ? word : `${word}s`}`;

interface PlaylistPickerProps {
  /** Reads the member's own playlists; null when Spotify or Tagify's read limit says to wait. */
  load: () => Promise<RootlistCatalogPlaylist[] | null>;
  /** Ticked when the picker opens: the member's last choice. */
  initial: readonly string[];
  /** Already checked; they aren't read again. */
  checked: readonly string[];
  /** `foldersUsed`: a folder was ticked as a whole. */
  onCheck: (chosen: string[], foldersUsed: boolean) => void;
  onClose: () => void;
}

/** "Choose playlists": the member's own playlists in their folders, to tick before a check reads them. */
export function PlaylistPicker({ load, initial, checked, onCheck, onClose }: PlaylistPickerProps) {
  const [playlists, setPlaylists] = useState<RootlistCatalogPlaylist[] | null | "loading">("loading");
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set(initial));
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [foldersUsed, setFoldersUsed] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const loadRef = useRef(load);
  useEffect(() => {
    let live = true;
    void loadRef.current().then((list) => { if (live) setPlaylists(list); }, () => { if (live) setPlaylists(null); });
    dialog.current?.focus();
    return () => { live = false; };
  }, []);

  const list = Array.isArray(playlists) ? playlists : [];
  const tree = useMemo(() => playlistTree(list), [list]);
  const known = useMemo(() => new Set(list.map((playlist) => playlist.playlistId)), [list]);
  const done = useMemo(() => new Set(checked), [checked]);
  // A choice saved earlier may name a playlist that's gone or no longer theirs: it's never read.
  const picked = [...chosen].filter((id) => known.has(id));
  const toRead = list.filter((playlist) => chosen.has(playlist.playlistId) && !done.has(playlist.playlistId));
  const reads = toRead.reduce((sum, playlist) => sum + playlistReads(playlist.songCount), 0);
  const songs = toRead.reduce((sum, playlist) => sum + (playlist.songCount ?? 0), 0);

  const setMany = (ids: string[], on: boolean) => setChosen((current) => {
    const next = new Set(current);
    for (const id of ids) if (on) next.add(id); else next.delete(id);
    return next;
  });
  const toggleOpen = (id: string) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const renderFolder = (node: FolderNode, depth: number): React.ReactNode => (
    <>
      {node.folders.map((folder) => {
        const ids = idsIn(folder);
        const on = ids.filter((id) => chosen.has(id)).length;
        const expanded = open.has(folder.id);
        return (
          <li key={`folder:${folder.id}`}>
            <div className={styles.item} style={{ paddingLeft: 8 + depth * 20 }}>
              <button type="button" className={`${styles.twisty} ${expanded ? styles.twistyOpen : ""}`} aria-expanded={expanded}
                aria-label={expanded ? `Close ${folder.name}` : `Open ${folder.name}`} onClick={() => toggleOpen(folder.id)}>
                <ChevronRight size={14} aria-hidden="true" />
              </button>
              <label className={styles.label}>
                <input type="checkbox" checked={on === ids.length} ref={(input) => { if (input) input.indeterminate = on > 0 && on < ids.length; }}
                  onChange={(event) => { setFoldersUsed(true); setMany(ids, event.target.checked); }} />
                <Folder size={15} aria-hidden="true" className={styles.icon} />
                <span className={styles.name}>{folder.name}</span>
                <span className={styles.count}>{plural(ids.length, "playlist")}</span>
              </label>
            </div>
            {expanded ? <ul className={styles.tree}>{renderFolder(folder, depth + 1)}</ul> : null}
          </li>
        );
      })}
      {node.playlists.map((playlist) => (
        <li key={playlist.playlistId}>
          <div className={styles.item} style={{ paddingLeft: 8 + depth * 20 + 22 }}>
            <label className={styles.label}>
              <input type="checkbox" checked={chosen.has(playlist.playlistId)} onChange={(event) => setMany([playlist.playlistId], event.target.checked)} />
              <ListMusic size={15} aria-hidden="true" className={styles.icon} />
              <span className={styles.name}>{playlist.playlistName}</span>
              <span className={styles.count}>
                {done.has(playlist.playlistId) ? "Checked" : playlist.songCount === null ? "" : plural(playlist.songCount, "song")}
              </span>
            </label>
          </div>
        </li>
      ))}
    </>
  );

  return (
    <Portal>
      <div className={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="playlist-picker-title" tabIndex={-1} ref={dialog}
          onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
          <h2 id="playlist-picker-title" className={styles.title}>Choose playlists to check</h2>
          <p className={styles.lead}>Only playlists you made are listed. Your Liked Songs are always checked.</p>
          {playlists === "loading" ? <p className={styles.status} role="status">Reading your playlists…</p>
            : playlists === null ? <p className={styles.status} role="alert">Spotify needs a break before Tagify can read your playlists. Try again in a little while.</p>
            : !list.length ? <p className={styles.status} role="status">You haven&apos;t made any playlists with songs yet.</p>
            : (
              <>
                <div className={styles.bulk}>
                  <button type="button" className={styles.bulkButton} onClick={() => setMany(list.map((playlist) => playlist.playlistId), true)}>Select all my playlists</button>
                  <button type="button" className={styles.bulkButton} onClick={() => setChosen(new Set())} disabled={!picked.length}>Clear</button>
                </div>
                <ul className={`${styles.tree} ${styles.treeRoot}`} aria-label="Your playlists">{renderFolder(tree, 0)}</ul>
              </>
            )}
          <div className={styles.footer}>
            <p className={styles.cost} role="status">
              {toRead.length ? `${plural(toRead.length, "playlist")}, ${plural(songs, "song")} · about ${plural(reads, "Spotify read")}` : picked.length ? "Every playlist you chose was checked already." : "No playlists chosen."}
            </p>
            <div className={styles.actions}>
              <button type="button" className={styles.cancel} onClick={onClose}>Cancel</button>
              <button type="button" className={styles.primary} disabled={!toRead.length} onClick={() => onCheck(picked, foldersUsed)}>
                {toRead.length ? `Check ${plural(toRead.length, "playlist")}` : "Check playlists"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
}

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Portal } from "@/components/ui";
import type { TagTaxonomy, TrackData } from "@/types/tagData";
import type { SmartPlaylistCriteria, SmartPlaylistFilterCriteria, SmartPlaylistRecipeBundle } from "../model/smartPlaylist.types";
import { CREATE_SHARED_TAG, SmartPlaylistShareError, getRecipeSelections, resolveSharedRecipeCriteria, type SmartPlaylistRecipeSelection } from "../utils/smartPlaylist.recipes";
import { spotifyApiService } from "@/services/SpotifyApiService";
import type { SmartPlaylistImportSummary, SpotifyPlaylistReference } from "../utils/smartPlaylist.import";
import { collectMatchingTrackUris } from "../utils/smartPlaylist.syncUtils";
import { buildResolvedTagLookup, normalizeTaxonomyTree } from "@/utils/tagTaxonomy";
import { formatTagFilterFormula } from "@/utils/tagFilterGroups";
import { getTagifyDatabaseName } from "@/services/sync/SyncLocalState";
import { storageService } from "@/services/storage/StorageService";
import styles from "./SmartPlaylistSharingDialog.module.css";

interface Props {
  mode: "share" | "restore" | "import" | "create";
  taxonomy: TagTaxonomy;
  playlists: SmartPlaylistCriteria[];
  bundle?: SmartPlaylistRecipeBundle;
  setup?: SmartPlaylistCriteria;
  backup?: SmartPlaylistCriteria[];
  availablePlaylists?: SpotifyPlaylistReference[];
  useExisting?: boolean;
  tracks?: Record<string, TrackData>;
  onShare: (selected: SmartPlaylistCriteria[]) => Promise<void> | void;
  onImport: (bundle: unknown, choices?: SmartPlaylistRecipeSelection[]) => Promise<SmartPlaylistImportSummary>;
  onCreate?: (setup: SmartPlaylistCriteria, existingPlaylist?: SpotifyPlaylistReference) => Promise<void>;
  onClose: () => void;
}

function describeRules(criteria: SmartPlaylistFilterCriteria, name: (id: string) => string): string {
  const parts = [formatTagFilterFormula({ clauses: criteria.includeTagClauses, connectors: criteria.clauseConnectors }, name)];
  if (criteria.ratingFilters.length) parts.push(`${criteria.ratingFilters.join(" or ")} stars`);
  if (criteria.energyMinFilter !== null || criteria.energyMaxFilter !== null) parts.push(`Energy ${criteria.energyMinFilter ?? "any"}–${criteria.energyMaxFilter ?? "any"}`);
  if (criteria.bpmMinFilter !== null || criteria.bpmMaxFilter !== null) parts.push(`BPM ${criteria.bpmMinFilter ?? "any"}–${criteria.bpmMaxFilter ?? "any"}`);
  if (criteria.camelotKeyFilters?.length) parts.push(`Key ${criteria.camelotKeyFilters.join(" or ")}`);
  else if (criteria.camelotMinFilter || criteria.camelotMaxFilter) parts.push(`Key ${criteria.camelotMinFilter ?? "any"}–${criteria.camelotMaxFilter ?? "any"}`);
  return parts.filter(Boolean).join(" · ") || "All songs with saved Tagify details";
}

function Matches({ uris, tracks }: { uris: string[]; tracks: Record<string, TrackData> }) {
  const local = uris.filter((uri) => uri.startsWith("spotify:local:"));
  const spotify = uris.filter((uri) => uri.startsWith("spotify:track:"));
  return <div className={styles.matches}>
    <strong>{spotify.length.toLocaleString()} Spotify {spotify.length === 1 ? "song matches" : "songs match"}</strong>
    {local.length > 0 ? <p>{local.length} local {local.length === 1 ? "song also matches" : "songs also match"}. Add {local.length === 1 ? "it" : "those"} manually in Spotify on the device where the files are saved.</p> : null}
    {uris.length === 0 ? <p>No songs match yet. You can save this setup for later, choose different tags, or edit its filters after saving. Creating new tags does not tag your songs.</p> : null}
    {spotify.length > 0 ? <details><summary>Preview matching songs</summary><ul>{spotify.slice(0, 10).map((uri, index) => <li key={uri}>{tracks[uri]?.name || `Song ${index + 1}`}{tracks[uri]?.artists ? ` — ${tracks[uri].artists}` : ""}</li>)}</ul>{spotify.length > 10 ? <p>And {(spotify.length - 10).toLocaleString()} more.</p> : null}</details> : null}
  </div>;
}

export default function SmartPlaylistSharingDialog({ mode, taxonomy, playlists, bundle, setup, backup, availablePlaylists = [], useExisting = false, tracks: providedTracks, onShare, onImport, onCreate, onClose }: Props) {
  const isExport = mode === "share";
  const [destination, setDestination] = useState(useExisting ? "" : "new");
  const [spotifyPlaylists, setSpotifyPlaylists] = useState(availablePlaylists);
  const [playlistLoadError, setPlaylistLoadError] = useState(false);
  const [playlistRetry, setPlaylistRetry] = useState(0);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);
  useEffect(() => {
    if (mode !== "create") return;
    let active = true;
    setLoadingPlaylists(true); setPlaylistLoadError(false);
    void spotifyApiService.getAllUserPlaylistReferencesStrict().then((items) => {
      if (active) setSpotifyPlaylists(items);
    }).catch(() => { if (active) setPlaylistLoadError(true); }).finally(() => { if (active) setLoadingPlaylists(false); });
    return () => { active = false; };
  }, [mode, playlistRetry]);
  const existingPlaylist = spotifyPlaylists.find((playlist) => playlist.playlistId === destination);
  const availableDestinations = spotifyPlaylists.filter((playlist) => !playlists.some((saved) => saved.id !== setup?.id && saved.playlistId === playlist.playlistId));
  const [selected, setSelected] = useState(() => new Set(playlists.map((p) => p.id ?? p.playlistId)));
  const [choices, setChoices] = useState(() => bundle ? getRecipeSelections(bundle, taxonomy, playlists) : []);
  const [tracks, setTracks] = useState<Record<string, TrackData> | null>(providedTracks ?? null);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState<SmartPlaylistImportSummary | "shared" | null>(null);
  const [tagSearch, setTagSearch] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  const saving = useRef(false);
  const account = useRef(getTagifyDatabaseName());
  const tags = useMemo(() => [...buildResolvedTagLookup(taxonomy).values()].map((tag) => ({ id: tag.id, label: [tag.categoryName, ...tag.folderPath, tag.name].join(" / ") })).sort((a, b) => a.label.localeCompare(b.label)), [taxonomy]);
  const tagNames = useMemo(() => new Map(tags.map((tag) => [tag.id, tag.label])), [tags]);
  useEffect(() => { if (providedTracks) setTracks(providedTracks); }, [providedTracks]);
  useEffect(() => {
    if (isExport || mode === "restore" || providedTracks) return;
    let active = true;
    setLoadError(false);
    void storageService.loadAllStrict().then((data) => { if (active) setTracks(data.tracks); }).catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, [mode, isExport, providedTracks, retry]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    return () => { document.body.style.overflow = previousOverflow; if (previous?.isConnected) previous.focus(); };
  }, []);
  const previews = useMemo(() => (bundle?.recipes ?? []).map((recipe, index) => {
    const choice = choices[index];
    if (!choice || choice.mode === "skip") return { uris: [], error: "" };
    if (Object.values(choice.tagMappings).some((id) => !id)) return { uris: [], error: "Choose a tag for each rule to see matching songs." };
    try {
      const copy = normalizeTaxonomyTree(JSON.parse(JSON.stringify(taxonomy)) as TagTaxonomy);
      const criteria = resolveSharedRecipeCriteria(recipe, choice, copy);
      return { uris: tracks ? collectMatchingTrackUris(tracks, criteria) : [], error: "" };
    } catch (cause) { return { uris: [], error: cause instanceof Error ? cause.message : "Choose your tags again." }; }
  }), [bundle, choices, taxonomy, tracks]);
  const existingRecipeIds = useMemo(() => new Set(bundle ? getRecipeSelections(bundle, taxonomy, playlists).filter((choice) => choice.mode === "skip").map((choice) => choice.recipeId) : []), [bundle, taxonomy, playlists]);
  const included = choices.filter((choice) => choice.mode !== "skip");
  const canImport = included.length > 0 && tracks !== null && !loadError && included.every((choice) => choice.name.trim().length > 0 && choice.name.length <= 200 && !previews[choices.indexOf(choice)].error);
  const updateChoice = (index: number, update: Partial<SmartPlaylistRecipeSelection>) => setChoices((current) => current.map((choice, i) => i === index ? { ...choice, ...update } : choice));
  const submit = async () => {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError("");
    try {
      if (getTagifyDatabaseName() !== account.current) throw new Error("Your Spotify account changed. Close this window and open the share again for your current account.");
      if (isExport) {
        const selectedPlaylists = playlists.filter((p) => selected.has(p.id ?? p.playlistId) && !p.criteria.includeTagClauses.some((c) => [...c.tagIds, ...c.excludedTagIds].some((id) => !taxonomy.tagsById[id])));
        await onShare(selectedPlaylists);
        setComplete("shared");
      } else if (mode === "restore" && backup) {
        setComplete(await onImport(backup));
      } else if (mode === "import" && bundle && canImport) {
        setComplete(await onImport(bundle, choices));
      } else if (mode === "create" && setup && onCreate) {
        if (destination === "new") await onCreate(setup);
        else if (existingPlaylist) await onCreate(setup, existingPlaylist);
        else throw new Error("Choose a Spotify playlist before connecting this setup.");
        onClose();
      }
    } catch (cause) {
      console.error("Smart playlist sharing failed", cause);
      setError(getTagifyDatabaseName() !== account.current ? "Your Spotify account changed. Close this window and open the share again for your current account." : mode === "create" ? (cause instanceof Error ? cause.message : "Spotify couldn’t create your playlist. Please try again.") : isExport ? (cause instanceof SmartPlaylistShareError ? cause.message : "Your setups couldn’t be saved to a file. Check their filters and try again.") : mode === "restore" ? (cause instanceof Error ? cause.message : "Your Smart Playlists couldn’t be restored. Try again with the original backup file.") : "These setups couldn’t be added. Your existing playlists are unchanged. Check your tag choices and try again.");
    } finally { saving.current = false; setBusy(false); }
  };
  const title = complete ? (complete === "shared" ? "Your share is ready" : mode === "restore" ? "Your Smart Playlists are restored" : "Your setups are saved") : mode === "restore" ? "Restore your Smart Playlists" : mode === "share" ? "Share smart playlist setups" : mode === "import" ? "Make these setups your own" : destination === "new" ? "Create your Spotify playlist" : "Use an existing Spotify playlist";
  return <Portal><div className={styles.overlay} onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div ref={dialog} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="playlist-sharing-title" tabIndex={-1} onKeyDown={(event) => {
      if (event.key === "Escape") { event.stopPropagation(); if (!busy) onClose(); }
      if (event.key === "Tab") {
        const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]') ?? [])].filter((node) => node.offsetParent !== null);
        const first = controls[0]; const last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <header className={styles.header}><div><span className={styles.eyebrow}>Smart playlists</span><h2 id="playlist-sharing-title">{title}</h2></div><button aria-label="Close sharing" disabled={busy} onClick={onClose}>×</button></header>
      <div className={styles.body}>
        {complete ? <>
          {complete !== "shared" && mode === "restore" ? <><p>{complete.importedCount} Smart Playlist{complete.importedCount === 1 ? "" : "s"} restored.</p><p>{complete.importedCount - complete.unresolvedCount} connected to existing Spotify playlists. Their saved sync settings were restored.</p>{complete.unresolvedCount ? <p>{complete.unresolvedCount} Smart Playlist{complete.unresolvedCount === 1 ? "" : "s"} couldn’t be connected automatically and {complete.unresolvedCount === 1 ? "remains" : "remain"} inactive. Use <strong>Use Existing Playlist</strong> to choose where they belong.</p> : null}{complete.verificationUnavailable ? <p>Spotify couldn’t verify your playlists. Your rules are saved; try connecting them again when Spotify is available.</p> : null}</> : complete === "shared" ? <><p>Look for the saved file in Downloads or your chosen save location, then send it to the person you want to share with.</p><ol><li>They open Smart Playlists in Tagify and choose Import.</li><li>They choose setups and match the tags to their own library.</li><li>They create a Spotify playlist or choose an existing one when ready.</li></ol><p>The file includes the selected names, descriptions, filters, and tag names. It does not include songs, ratings on individual songs, or access to your Spotify account.</p></> : <><p>{complete.importedCount} setup{complete.importedCount === 1 ? "" : "s"} added{complete.skippedCount ? `; ${complete.skippedCount} skipped` : ""}.</p>{complete.createdTagCount ? <p>{complete.createdTagCount} new tag{complete.createdTagCount === 1 ? "" : "s"} created. Your songs keep their current tags and ratings.</p> : null}<p>Your new setups are inactive. Use <strong>Edit Filters</strong> to adjust them, or choose <strong>Create Spotify Playlist</strong> or <strong>Use Existing Playlist</strong> when ready. Your existing setups and Spotify playlists were kept.</p></>}
        </> : <>
          {mode === "restore" && backup ? <>
            <p>Restore {backup.length} saved Smart Playlist{backup.length === 1 ? "" : "s"} and reconnect them to your Spotify playlists.</p>
            <p className={styles.notice}>Import your tags first. Saved active playlists will resume updating: matching songs are added and songs that don’t match can be removed. Existing songs keep their tags and ratings.</p>
            <p>Tagify checks the saved playlist first, then a unique name match. If there’s no clear match, the rules stay saved and inactive for you to connect. Other Smart Playlists are kept.</p>
            {backup.map((playlist, index) => <article className={styles.card} key={playlist.id ?? index}><strong>{playlist.playlistName}</strong><p className={styles.rules}>{describeRules(playlist.criteria, (id) => tagNames.get(id) ?? "Missing tag")}</p><p>{playlist.isActive ? "Resume automatic updates when connected" : "Keep automatic updates off"}</p></article>)}
          </> : isExport ? <>
            <p>Choose the setups to share. The recipient will use their own songs, tags, and ratings.</p>
            <p className={styles.notice}>Shared names, descriptions, filters, and tag names will be visible to anyone with the file. Songs and Spotify connections stay private.</p>
            {playlists.length ? <div className={styles.toolbar}><button disabled={busy} onClick={() => setSelected(new Set(playlists.map((p) => p.id ?? p.playlistId)))}>Select all</button><button disabled={busy} onClick={() => setSelected(new Set())}>Clear selection</button></div> : <p>Create a smart playlist before sharing a setup.</p>}
            {playlists.map((playlist) => {
              const missing = playlist.criteria.includeTagClauses.some((clause) => [...clause.tagIds, ...clause.excludedTagIds].some((id) => !taxonomy.tagsById[id]));
              return <label key={playlist.id ?? playlist.playlistId} className={styles.shareCard}><input type="checkbox" checked={!missing && selected.has(playlist.id ?? playlist.playlistId)} disabled={missing || busy} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(playlist.id ?? playlist.playlistId); else next.delete(playlist.id ?? playlist.playlistId); return next; })} /><span><strong>{playlist.playlistName}</strong><span className={styles.rules}>{describeRules(playlist.criteria, (id) => tagNames.get(id) ?? "Missing tag")}</span>{playlist.description ? <span className={styles.rules}>{playlist.description}</span> : null}{missing ? <span className={styles.warning}>A filter uses a missing tag. Edit its filters before sharing.</span> : null}</span></label>;
            })}
          </> : mode === "import" && bundle ? <>
            <p>Choose what to add, then match each shared tag to a tag you use. These rules will use your saved Tagify songs and ratings.</p>
            <p className={styles.notice}>Existing setups stay as they are. Nothing will change in Spotify until you create a playlist or connect an existing one.</p>
            {tags.length ? <label className={styles.search}>Find your tags<input disabled={busy} type="search" placeholder="Search tag names or folders" value={tagSearch} onChange={(event) => setTagSearch(event.target.value)} /></label> : null}
            {bundle.recipes.map((recipe, index) => {
              const choice = choices[index];
              const existing = existingRecipeIds.has(recipe.id);
              const chosen = choice.mode !== "skip";
              const referenceNames = new Map(recipe.tagReferences.map((ref) => [ref.key, ref.name]));
              return <article className={styles.card} key={recipe.id}>
                <label className={styles.selection}><input type="checkbox" checked={chosen} disabled={busy} onChange={(event) => updateChoice(index, { mode: event.target.checked ? existing ? "copy" : "add" : "skip" })} /><strong>{existing ? `Add a separate copy of ${recipe.name}` : `Add ${recipe.name}`}</strong></label>
                {existing ? <p className={styles.notice}>You already have a setup from this share. Your saved rules, edits, and Spotify connection will be kept.</p> : null}
                <p className={styles.rules}>{describeRules(recipe.criteria, (id) => referenceNames.get(id) ?? "Unavailable tag")}</p>
                {recipe.description ? <p className={styles.rules}>{recipe.description}</p> : null}
                {chosen ? <fieldset disabled={busy} className={styles.fields}><legend className={styles.srOnly}>Your choices for {recipe.name}</legend>
                  <label>Setup name<input value={choice.name} maxLength={200} onChange={(event) => updateChoice(index, { name: event.target.value })} /></label>
                  {recipe.tagReferences.map((ref) => {
                    const selectedTag = choice.tagMappings[ref.key];
                    const excluded = recipe.criteria.includeTagClauses.some((clause) => clause.excludedTagIds.includes(ref.key));
                    const filtered = tags.filter((tag) => tag.id === selectedTag || tag.label.toLocaleLowerCase().includes(tagSearch.toLocaleLowerCase()));
                    return <div key={ref.key} className={styles.tagRow}><label>{excluded ? "Exclude" : "Match"}: {ref.name}<span className={styles.path}>{[ref.categoryName, ...ref.folderPath].join(" / ")}</span><select aria-label={`Your tag for ${ref.name} in ${recipe.name}`} value={selectedTag} onChange={(event) => updateChoice(index, { tagMappings: { ...choice.tagMappings, [ref.key]: event.target.value } })}><option value="">Choose your tag</option><option value={CREATE_SHARED_TAG}>Create shared tag: {ref.name}</option>{filtered.map((tag) => <option key={tag.id} value={tag.id}>{tag.label}</option>)}</select></label>{selectedTag === CREATE_SHARED_TAG ? <p className={styles.warning}>{excluded ? "This new tag won’t exclude any of your songs until you assign it to them." : "This creates an empty tag. To match songs now, choose a tag already used on your songs."}</p> : null}</div>;
                  })}
                  {previews[index]?.error ? <p className={styles.warning}>{previews[index].error}</p> : tracks ? <Matches uris={previews[index].uris} tracks={tracks} /> : null}
                </fieldset> : null}
              </article>;
            })}
            <p className={styles.hint}>Tag groups follow the AND/OR shown above. “AND” requires every included tag; “OR” allows any included tag. Excluded tags keep songs out of that group. Ratings, energy, BPM, and keys must also match your own saved details.</p>
          </> : setup ? <>
            <label className={styles.search}>Spotify playlist<select value={destination} disabled={busy} onChange={(event) => setDestination(event.target.value)}><option value="new">Create a new private playlist</option><option value="" disabled>Choose an existing playlist</option>{availableDestinations.map((playlist) => <option key={playlist.playlistId} value={playlist.playlistId}>{playlist.playlistName}</option>)}</select></label>
            {loadingPlaylists ? <p role="status">Reading your Spotify playlists…</p> : null}
            {playlistLoadError ? <div role="alert"><p>Your Spotify playlists couldn’t be read.</p><button disabled={busy} onClick={() => setPlaylistRetry((value) => value + 1)}>Retry playlists</button></div> : null}
            {!loadingPlaylists && !playlistLoadError && !availableDestinations.length ? <p>No other Spotify playlists are available. Create a new playlist, or save this setup for later.</p> : null}
            <h3>{setup.playlistName}</h3><p className={styles.rules}>{describeRules(setup.criteria, (id) => tagNames.get(id) ?? "Missing tag")}</p>
            {tracks ? <Matches uris={collectMatchingTrackUris(tracks, setup.criteria)} tracks={tracks} /> : null}
            <p className={styles.notice}>{destination === "new" ? "Creates a new private playlist in your Spotify account. Your existing playlists and songs keep their tags and ratings." : `Connects ${existingPlaylist ? `“${existingPlaylist.playlistName}”` : "the playlist you choose"} to these rules. Songs that don’t match can be removed from that playlist. Existing songs keep their tags and ratings.`}</p>
            <p>Sync will keep this playlist up to date: songs that match are added, and songs that stop matching are removed from this playlist.</p>
            <p>If you later add a song to this active playlist in Spotify, Tagify can apply its tags, rating, and energy rules to that song. Tagify asks you to choose when the tag rules allow more than one answer.</p>
          </> : null}
          {!isExport && mode !== "restore" && !tracks && !loadError ? <p role="status">Reading your saved songs…</p> : null}
          {loadError ? <div role="alert"><p>Your saved songs couldn’t be read, so the preview is unavailable.</p><button onClick={() => setRetry((value) => value + 1)}>Retry preview</button></div> : null}
        </>}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
      </div>
      <footer className={styles.footer}>{complete ? <button className={styles.primary} onClick={onClose}>Done</button> : <><button disabled={busy} onClick={onClose}>Cancel</button><button className={styles.primary} disabled={busy || (isExport ? !playlists.some((p) => selected.has(p.id ?? p.playlistId) && !p.criteria.includeTagClauses.some((c) => [...c.tagIds, ...c.excludedTagIds].some((id) => !taxonomy.tagsById[id]))) : mode === "restore" ? !backup?.length : mode === "import" ? !canImport : !tracks || loadError || (destination !== "new" && (!existingPlaylist || loadingPlaylists || playlistLoadError)))} onClick={() => void submit()}>{busy ? "Saving…" : mode === "share" ? "Save share file" : mode === "restore" ? "Restore Smart Playlists" : mode === "import" ? `Add ${included.length} setup${included.length === 1 ? "" : "s"}` : destination === "new" ? "Create playlist and enable sync" : "Connect playlist and enable sync"}</button></>}</footer>
    </div>
  </div></Portal>;
}

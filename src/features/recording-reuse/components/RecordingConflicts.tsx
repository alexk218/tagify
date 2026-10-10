import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Portal } from "@/components/ui";
import type { TagTaxonomy } from "@/types/tagData";
import { findDisplayTagName } from "@/utils/tagTaxonomy";
import type { RecordingChoices, RecordingSet } from "../utils/recordingLibrary";
import styles from "./RecordingConflicts.module.css";

function RecordingReview({ group, taxonomy, onClose, onSave }: { group: RecordingSet; taxonomy: TagTaxonomy; onClose: () => void; onSave: (choices: RecordingChoices) => Promise<void> }) {
  const values = (field: "rating" | "energy") => [...new Set(group.entries.map(([, data]) => data[field]).filter(value => value > 0))].sort((a, b) => a - b);
  const ratings = values("rating"), energies = values("energy");
  const allTags = [...new Set(group.entries.flatMap(([, data]) => data.tagIds))].filter(id => taxonomy.tagsById[id]);
  const tagName = (id: string) => findDisplayTagName(taxonomy, id, { disambiguate: true });
  const [tags, setTags] = useState(allTags);
  const [rating, setRating] = useState<number | null>(ratings.length > 1 ? null : ratings[0] || 0);
  const [energy, setEnergy] = useState<number | null>(energies.length > 1 ? null : energies[0] || 0);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus(); };
  }, []);
  const save = async () => {
    if (busy || rating === null || energy === null) return;
    setBusy(true); setError("");
    try { await onSave({ tagIds: tags, rating, energy }); }
    catch (cause) { console.debug("Tagify: Duplicate song choices were not saved", cause); setError("Your choices couldn't be saved. They're kept here. Try again, or close this window and review the latest saved choices."); setBusy(false); }
  };
  const first = group.entries[0][1];
  return <div className={styles.overlay} onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div ref={dialog} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="duplicate-song-title" aria-describedby="duplicate-song-description" aria-busy={busy} onKeyDown={event => {
      if (event.key === "Escape" && !busy) { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const controls = [...(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)") || [])];
      const firstControl = controls[0], lastControl = controls.at(-1);
      if (event.shiftKey && document.activeElement === firstControl) { event.preventDefault(); lastControl?.focus(); }
      else if (!event.shiftKey && document.activeElement === lastControl) { event.preventDefault(); firstControl?.focus(); }
    }}>
      <header className={styles.header}><h2 id="duplicate-song-title">Choose what to keep</h2><button className={styles.close} aria-label="Close review" disabled={busy} onClick={onClose}><X size={20} aria-hidden="true" /></button></header>
      <div className={styles.content}>
        <h3 className={styles.song}>{first.name || first.recordingIdentity?.name || "This song"}</h3>
        {first.artists && <p className={styles.artist}>{first.artists}</p>}
        <p id="duplicate-song-description" className={styles.description}>Choose shared tags and ratings for this song. Future edits will apply to every copy.</p>
        <div className={styles.copies}>{group.entries.map(([uri, data]) => <div key={uri} className={styles.copy}><strong>{data.albumName || "Saved copy"}</strong><span>{data.rating > 0 ? `${data.rating} ★` : "No rating"}{data.energy > 0 ? ` · Energy ${data.energy}` : ""}</span><span>{data.tagIds.filter(id => taxonomy.tagsById[id]).map(tagName).join(", ") || "No tags"}</span></div>)}</div>
        {allTags.length > 0 && <fieldset className={styles.field}><legend>Tags to keep</legend><p className={styles.hint}>All tags are selected. Remove any you don't want.</p><div className={styles.tags}>{allTags.map(id => <button key={id} type="button" className={styles.tag} aria-pressed={tags.includes(id)} disabled={busy} onClick={() => setTags(previous => previous.includes(id) ? previous.filter(tag => tag !== id) : [...previous, id])}>{tagName(id)}</button>)}</div></fieldset>}
        <div className={styles.values}>
          {ratings.length > 1 && <fieldset className={styles.field}><legend>Rating to keep</legend><div className={styles.choices}>{ratings.map(value => <label key={value}><input type="radio" name="duplicate-rating" value={value} checked={rating === value} disabled={busy} onChange={() => setRating(value)} />{value} ★</label>)}</div></fieldset>}
          {energies.length > 1 && <fieldset className={styles.field}><legend>Energy to keep</legend><div className={styles.choices}>{energies.map(value => <label key={value}><input type="radio" name="duplicate-energy" value={value} checked={energy === value} disabled={busy} onChange={() => setEnergy(value)} />{value}</label>)}</div></fieldset>}
        </div>
        {error && <p className={styles.error} role="alert">{error}</p>}
      </div>
      <footer className={styles.footer}><button className={styles.secondary} disabled={busy} onClick={onClose}>Later</button><button className={styles.primary} disabled={busy || rating === null || energy === null} onClick={() => void save()}>{busy ? "Saving…" : "Save choices"}</button></footer>
    </div>
  </div>;
}

export function RecordingConflicts({ groups, taxonomy, onSave }: { groups: RecordingSet[]; taxonomy: TagTaxonomy; onSave: (group: RecordingSet, choices: RecordingChoices) => Promise<void> }) {
  const [selected, setSelected] = useState<RecordingSet | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => { setSelected(null); trigger.current?.focus(); };
  if (!groups.length && !selected) return null;
  return <>
    {groups.length > 0 && <div className={styles.notice} role="status"><span>{groups.length === 1 ? "One song has different choices across its copies." : `${groups.length} songs have different choices across their copies.`}</span><button ref={trigger} onClick={() => setSelected(groups[0])}>Review</button></div>}
    {selected && <Portal><RecordingReview key={selected.key} group={selected} taxonomy={taxonomy} onClose={close} onSave={async choices => {
      await onSave(selected, choices);
      const next = groups.find(group => group.key !== selected.key);
      if (next) setSelected(next); else close();
    }} /></Portal>}
  </>;
}

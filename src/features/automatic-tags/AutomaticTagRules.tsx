import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { buildCategoryTree } from "@/utils/tagTaxonomy";
import { listTags } from "@/features/tag-data/utils/tagLists";
import { Portal } from "@/components/ui";
import { playlistMembershipStore } from "@/features/track-insights/services/playlistMembership";
import { albumTrackListsStore } from "@/features/playlist-state/services/albumTrackLists";
import { getTagifyDatabaseName } from "@/services/sync/SyncLocalState";
import type { BatchTagUpdate, TagDataStructure } from "@/types/tagData";
import { planRule, ruleCandidates, spotifyScope, type AutomaticTagRule, type TagCondition } from "./rules";
import { readRules, subscribeRules, writeRules } from "./store";
import { useRuleContext } from "./useAutomaticTags";
import { checkRuleDetails, readRuleFacts } from "./facts";
import styles from "./AutomaticTagRules.module.css";

interface Props { data: TagDataStructure; onApply: (updates: BatchTagUpdate[]) => Promise<void>; onUndo: () => Promise<void> }
const fresh = (): AutomaticTagRule => ({ id: crypto.randomUUID(), name: "", enabled: false, scopes: [], conditions: [{ field: "length", max: 180 }], tagIds: [], otherwiseTagIds: [] });
const displayNumber = (field: TagCondition["field"], value?: number) => value === undefined ? "" : field === "bpm" ? String(value) : `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
const parseNumber = (field: TagCondition["field"], value: string) => {
  if (!value.trim()) return undefined;
  if (field === "bpm") return /^\d+(\.\d+)?$/.test(value) ? Number(value) : NaN;
  const match = value.match(/^(\d+):([0-5]\d)$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
};

export default function AutomaticTagRules({ data, onApply, onUndo }: Props) {
  const [open, setOpen] = useState(false);
  return <>
    <button className={styles.launch} onClick={() => setOpen(true)}>Automatic tags</button>
    {open && <RuleDialog data={data} onApply={onApply} onUndo={onUndo} onClose={() => setOpen(false)} />}
  </>;
}

function RuleDialog({ data, onApply, onUndo, onClose }: Props & { onClose: () => void }) {
  const rules = useSyncExternalStore(subscribeRules, readRules);
  const context = useRuleContext();
  const [draft, setDraft] = useState(fresh);
  const [showEditor, setShowEditor] = useState(!rules.length);
  const [checkingDetails, setCheckingDetails] = useState(false);
  const [scopeLink, setScopeLink] = useState("");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [keepApplying, setKeepApplying] = useState(false);
  const [preview, setPreview] = useState<{ rule: AutomaticTagRule; plan: ReturnType<typeof planRule> } | null>(null);
  const cancel = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const focusDialog = useCallback((node: HTMLDivElement | null) => { dialog.current = node; }, []);
  const account = useRef(getTagifyDatabaseName());
  const latest = useRef({ data, context }); latest.current = { data, context };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => { cancel.current = true; previous?.focus(); };
  }, []);
  const scopeName = (uri: string) => data.playlists[uri]?.name || data.artists[uri]?.name || `Spotify ${uri.split(":")[1]}`;
  const choices = Object.entries({ ...data.playlists, ...data.artists }).map(([uri]) => ({ uri, name: `${uri.split(":")[1]} · ${scopeName(uri)}` }));
  const tagPaths = useMemo(() => Object.fromEntries(listTags(buildCategoryTree(data.taxonomy)).map(tag => [tag.id, tag.path])), [data.taxonomy]);
  const tags = Object.values(data.taxonomy.tagsById).filter(tag => tag.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  const fail = (error: unknown) => setMessage(error instanceof Error ? error.message : "Your changes couldn’t be saved. Please try again.");
  const addScope = (uri: string) => setDraft(r => ({ ...r, scopes: [...new Set([...r.scopes, uri])].slice(0, 5) }));
  const checkAccount = () => { if (account.current !== getTagifyDatabaseName()) throw new Error("Your account changed. Close this window and reopen your rules."); };
  const review = async (rule: AutomaticTagRule) => {
    cancel.current = false;
    setBusy(true); setMessage(""); setPreview(null);
    try {
      checkAccount();
      for (const uri of rule.scopes.filter(uri => uri.startsWith("spotify:playlist:"))) {
        await playlistMembershipStore.request(uri, data.playlists[uri]?.snapshotId || "");
        checkAccount(); if (cancel.current) return;
        if (playlistMembershipStore.getSnapshot()[uri]?.status !== "loaded") throw new Error("That playlist couldn’t be checked. Try previewing again when Spotify is available.");
      }
      for (const uri of rule.scopes.filter(uri => uri.startsWith("spotify:album:"))) {
        if (cancel.current) return;
        await albumTrackListsStore.request(uri, albumTrackListsStore.getSnapshot()[uri]?.status === "failed");
        checkAccount(); if (cancel.current) return;
        if (albumTrackListsStore.getSnapshot()[uri]?.status !== "loaded") throw new Error("That album couldn’t be checked. Try previewing again when Spotify is available.");
      }
      // The subscription updates React after playlist reads finish.
      const publicFacts = readRuleFacts();
      const checkedContext = { ...latest.current.context,
        facts: Object.fromEntries([...new Set([...Object.keys(latest.current.context.facts), ...Object.keys(publicFacts)])].map(uri => [uri, { ...latest.current.context.facts[uri], ...publicFacts[uri] }])),
        playlists: Object.fromEntries(Object.entries(playlistMembershipStore.getSnapshot()).map(([uri, entry]) => [uri, entry.status === "loaded" ? new Set(entry.uris) : undefined])),
        albums: Object.fromEntries(Object.entries(albumTrackListsStore.getSnapshot()).map(([uri, entry]) => [uri, entry.status === "loaded" ? new Set(entry.tracks.map(track => track.uri)) : undefined])),
      };
      setShowEditor(false);
      setDraft({ ...rule, enabled: false }); setKeepApplying(rule.enabled);
      setPreview({ rule: { ...rule, enabled: false }, plan: planRule(rule, latest.current.data, checkedContext) });
    } catch (error) { fail(error); } finally { setBusy(false); }
  };
  const save = async () => {
    try {
      checkAccount();
      const rule = { ...draft, enabled: false };
      writeRules([...rules.filter(r => r.id !== rule.id), rule]);
      await review(rule);
    } catch (error) { fail(error); }
  };
  const apply = async () => {
    if (!preview) return;
    setBusy(true); setMessage("");
    try {
      checkAccount();
      const saved = readRules().find(r => r.id === preview.rule.id);
      if (!saved || JSON.stringify({ ...saved, enabled: false }) !== JSON.stringify(preview.rule)) throw new Error("This rule changed. Preview it again before applying.");
      const publicFacts = readRuleFacts();
      const context = { ...latest.current.context, facts: Object.fromEntries([...new Set([...Object.keys(latest.current.context.facts), ...Object.keys(publicFacts)])].map(uri => [uri, { ...latest.current.context.facts[uri], ...publicFacts[uri] }])) };
      const plan = planRule(saved, latest.current.data, context);
      if (JSON.stringify(plan.updates) !== JSON.stringify(preview.plan.updates)) throw new Error("Your songs or their details changed. Preview again to see the current changes.");
      if (plan.updates.length) await onApply(plan.updates);
      checkAccount();
      writeRules(readRules().map(r => r.id === saved.id ? { ...r, enabled: keepApplying } : r));
      setMessage(`${plan.updates.length} song${plan.updates.length === 1 ? "" : "s"} updated.${keepApplying ? " This rule will keep applying as song details become available." : " The rule is saved and paused."}`);
      setPreview(null);
    } catch (error) { fail(error); } finally { setBusy(false); }
  };
  const checkDetails = async () => {
    setCheckingDetails(true); setBusy(true); setMessage("Checking up to 50 saved songs. You can stop at any time."); cancel.current = false;
    try {
      checkAccount();
      const candidates = Object.keys(ruleCandidates(draft, latest.current.data, latest.current.context).tracks);
      const checked = await checkRuleDetails(candidates, () => !cancel.current && account.current === getTagifyDatabaseName(), count => setMessage(`${count} song details checked…`), new Set(candidates.filter(uri => !data.tracks[uri])));
      setMessage(`${checked} song details checked. Preview your rule again.`); setPreview(null); setShowEditor(false);
    } catch (error) { fail(error); } finally { setBusy(false); setCheckingDetails(false); }
  };
  const tagPicker = (key: "tagIds" | "otherwiseTagIds", label: string) => <fieldset className={styles.tags}>
    <legend>{label}</legend>
    {tags.map(tag => <label key={tag.id} title={tagPaths[tag.id] || tag.name}><input type="checkbox" checked={draft[key].includes(tag.id)} onChange={e => {
      setPreview(null); setDraft(r => ({ ...r, [key]: e.target.checked ? [...r[key], tag.id] : r[key].filter(id => id !== tag.id) }));
    }} />{tag.name} <small>{tagPaths[tag.id]?.split(" / ").slice(0, -1).join(" / ")}</small></label>)}
    {draft[key].filter(id => !data.taxonomy.tagsById[id]).map(id => <button key={id} onClick={() => setDraft(r => ({ ...r, [key]: r[key].filter(tag => tag !== id) }))}>Remove unavailable tag</button>)}
    {!tags.length && <p>No matching tags. Create tags in Manage Tags first.</p>}
  </fieldset>;
  return <Portal><div className={styles.overlay} onClick={() => { cancel.current = true; onClose(); }}>
    <div className={styles.dialog} ref={focusDialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="automatic-tags-title" onClick={e => e.stopPropagation()} onKeyDown={e => {
      if (e.key === "Escape") { e.stopPropagation(); cancel.current = true; onClose(); }
      if (e.key === "Tab") {
        const items = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),summary')].filter(item => item.getClientRects().length);
        const first = items[0], last = items.at(-1);
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    }}>
      <header><h2 id="automatic-tags-title">Automatic tags</h2><button aria-label="Close automatic tags" onClick={onClose}>×</button></header>
      <p>Save time with rules for your saved songs or a chosen album or playlist. Rules only add tags; your ratings, energy and existing Last Updated order stay the same.</p>
      <div className={styles.saved} aria-label="Saved automatic tag rules">
        {rules.map(rule => <div key={rule.id}><span title={rule.name}>{rule.name} · {rule.enabled ? "On" : "Paused"}</span><button disabled={busy} onClick={() => { setShowEditor(true); setDraft({ ...rule, enabled: false }); setPreview(null); setMessage(""); }}>Edit</button><button disabled={busy} onClick={() => void review(rule)}>Preview</button>{rule.enabled && <button disabled={busy} onClick={() => { try { checkAccount(); writeRules(rules.map(r => r.id === rule.id ? { ...r, enabled: false } : r)); } catch (error) { fail(error); } }}>Pause</button>}<button disabled={busy} onClick={() => { try { checkAccount(); writeRules(rules.filter(r => r.id !== rule.id)); setPreview(null); } catch (error) { fail(error); } }}>Remove</button></div>)}
        <button disabled={busy} onClick={() => { setShowEditor(true); setDraft(fresh()); setPreview(null); setMessage(""); }}>New rule</button>
      </div>
      <p role="status">{message}</p>
      {preview && <section className={styles.preview} aria-label="Automatic tag preview"><h3>Preview: {preview.rule.name}</h3><p>{preview.rule.scopes.length ? `Within ${preview.rule.scopes.map(scopeName).join(" and ")}` : "All saved songs"} · {preview.rule.conditions.map(c => `${c.field === "length" ? "Length" : "BPM"} ${displayNumber(c.field, c.min) || "any"} to ${displayNumber(c.field, c.max) || "any"}`).join(" and ")}</p><p>Add: {preview.rule.tagIds.map(id => data.taxonomy.tagsById[id]?.name || "Tag unavailable").join(", ")}{preview.rule.otherwiseTagIds.length ? ` · Otherwise: ${preview.rule.otherwiseTagIds.map(id => data.taxonomy.tagsById[id]?.name || "Tag unavailable").join(", ")}` : ""}</p><button disabled={busy} onClick={() => { setShowEditor(true); setPreview(null); }}>Back to edit</button><p>{preview.plan.matched} song{preview.plan.matched === 1 ? " matches" : "s match"} · {preview.plan.updates.length} song{preview.plan.updates.length === 1 ? " will" : "s will"} gain tags · {preview.plan.unknown} song{preview.plan.unknown === 1 ? " needs" : "s need"} more details.</p>
        <ul>{preview.plan.updates.slice(0, 20).map(u => <li key={u.trackUri}>{data.tracks[u.trackUri]?.name || context.facts[u.trackUri]?.name || "Song in your selection"} — {u.toAdd.map(id => data.taxonomy.tagsById[id]?.name).join(", ")}{!data.tracks[u.trackUri] && <span> · New to Tagify</span>}</li>)}</ul>
        {preview.plan.updates.length > 20 && <p>And {preview.plan.updates.length - 20} more songs.</p>}
        <label><input type="checkbox" checked={keepApplying} disabled={busy} onChange={e => setKeepApplying(e.target.checked)} />Keep applying automatically as details load</label>
        <button disabled={busy} onClick={() => void apply()}>{preview.plan.updates.length ? `Apply to ${preview.plan.updates.length} song${preview.plan.updates.length === 1 ? "" : "s"}` : "Save automatic setting"}</button>
      </section>}
      {!preview && showEditor && <fieldset disabled={busy} className={styles.editor} onChange={() => setPreview(null)}>
        <label>Rule name<input value={draft.name} maxLength={60} onChange={e => setDraft(r => ({ ...r, name: e.target.value }))} placeholder="Short songs" /></label>
        <h3>Choose songs</h3><p>All saved songs by default. A chosen album or playlist also includes its untagged songs when their details are available. Artist selections use confirmed songs known to Tagify. Songs must belong to every selection.</p>
        <select aria-label="Choose playlist, album or artist" value="" onChange={e => { if (e.target.value) addScope(e.target.value); }}><option value="">Choose saved music…</option>{choices.map(c => <option key={c.uri} value={c.uri}>{c.name}</option>)}</select>
        <div className={styles.row}><input aria-label="Spotify playlist, album or artist link" value={scopeLink} onChange={e => setScopeLink(e.target.value)} placeholder="Or paste a Spotify link" /><button onClick={() => { const uri = spotifyScope(scopeLink); if (!uri) setMessage("Paste a Spotify playlist, album or artist link."); else { addScope(uri); setScopeLink(""); } }}>Add selection</button></div>
        {draft.scopes.map(uri => <button key={uri} title={scopeName(uri)} onClick={() => setDraft(r => ({ ...r, scopes: r.scopes.filter(s => s !== uri) }))}>{scopeName(uri)} ×</button>)}
        <h3>When all of these match</h3>
        {draft.conditions.map((c, index) => <Condition key={index} condition={c} onChange={next => setDraft(r => ({ ...r, conditions: r.conditions.map((old, i) => i === index ? next : old) }))} onRemove={() => setDraft(r => ({ ...r, conditions: r.conditions.filter((_, i) => i !== index) }))} />)}
        <button disabled={draft.conditions.length >= 5} onClick={() => setDraft(r => ({ ...r, conditions: [...r.conditions, { field: "bpm", min: 120 }] }))}>Add condition</button>
        <p>Length uses minutes:seconds. Ranges include both ends; leave an end blank for no limit. Unavailable details are skipped.</p>
        <label>Find tags<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search your tags" /></label>
        {tagPicker("tagIds", "Add these tags")}
        <details><summary>Otherwise add different tags (optional)</summary><p>Only applies inside your chosen music when all needed details are known.</p>{tagPicker("otherwiseTagIds", "Otherwise add")}</details>
        <button onClick={() => void save()}>Save & preview</button>
      </fieldset>}
      <footer><button disabled={busy} onClick={() => void checkDetails()}>Check next 50 song details</button>{checkingDetails && <button onClick={() => { cancel.current = true; }}>Stop checking</button>}<button disabled={busy} onClick={async () => { setBusy(true); try { checkAccount(); await onUndo(); setPreview(null); setMessage("Last bulk change undone. Any automatic rules for that change are paused."); } catch (error) { fail(error); } finally { setBusy(false); } }}>Undo last bulk change</button></footer>
      <p>Rules reuse song details already loaded by Tagify. Checking missing details is optional and stops if Spotify is unavailable. Saved rules are included in your private backups.</p>
    </div>
  </div></Portal>;
}

function Condition({ condition, onChange, onRemove }: { condition: TagCondition; onChange: (c: TagCondition) => void; onRemove: () => void }) {
  const [min, setMin] = useState(displayNumber(condition.field, condition.min));
  const [max, setMax] = useState(displayNumber(condition.field, condition.max));
  const minInput = useRef<HTMLInputElement>(null), maxInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (document.activeElement !== minInput.current) setMin(displayNumber(condition.field, condition.min));
    if (document.activeElement !== maxInput.current) setMax(displayNumber(condition.field, condition.max));
  }, [condition.field, condition.min, condition.max]);
  return <div className={styles.row}>
    <select aria-label="Song detail" value={condition.field} onChange={e => onChange({ field: e.target.value as TagCondition["field"], min: e.target.value === "bpm" ? 120 : 0 })}><option value="length">Song length</option><option value="bpm">BPM</option></select>
    <label>From<input ref={minInput} aria-label={`Minimum ${condition.field}`} value={min} placeholder={condition.field === "bpm" ? "No minimum" : "0:00"} onChange={e => { setMin(e.target.value); onChange({ ...condition, min: parseNumber(condition.field, e.target.value) }); }} /></label>
    <label>To<input ref={maxInput} aria-label={`Maximum ${condition.field}`} value={max} placeholder="No maximum" onChange={e => { setMax(e.target.value); onChange({ ...condition, max: parseNumber(condition.field, e.target.value) }); }} /></label>
    <button aria-label="Remove condition" onClick={onRemove}>×</button>
  </div>;
}

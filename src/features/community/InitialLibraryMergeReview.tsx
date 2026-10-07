import React, { useMemo, useState } from "react";
import { Download, Search, ShieldCheck } from "lucide-react";
import type { InitialMergeConflictV1, InitialMergeResultV1, InitialMergeSource } from "@tagify/sync-contracts";
import type { InitialMergeReview } from "@/services/sync/SyncRuntime";
import styles from "./CloudSyncModal.module.css";
import { communityErrorMessage } from "./communitySyncCopy";

type ConflictFilter = "all" | "music" | "organization" | "playlists" | "settings";

export function InitialLibraryMergeReview({
  review,
  onCommit,
  onDownloadBackup,
}: {
  review: InitialMergeReview;
  onCommit: (resolutions: Record<string, InitialMergeSource>) => Promise<InitialMergeResultV1>;
  onDownloadBackup: () => Promise<void>;
}) {
  const [bulkChoice, setBulkChoice] = useState<InitialMergeSource | null>(null);
  const [overrides, setOverrides] = useState<Record<string, InitialMergeSource>>({});
  const [filter, setFilter] = useState<ConflictFilter>("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<InitialMergeResultV1 | null>(null);

  const conflicts = useMemo(() => review.conflicts.filter((conflict) => {
    if (filter !== "all" && conflictCategory(conflict) !== filter) return false;
    const searchable = `${review.labels[conflict.id] || ""} ${conflict.field || ""}`.toLowerCase();
    return !query.trim() || searchable.includes(query.trim().toLowerCase());
  }), [filter, query, review]);

  const resolutions = bulkChoice
    ? Object.fromEntries(review.conflicts.map((conflict) => [conflict.id, overrides[conflict.id] || bulkChoice]))
    : {};

  const applyBulkChoice = (source: InitialMergeSource) => {
    setBulkChoice(source);
    setOverrides({});
  };

  const commit = async () => {
    setBusy(true);
    setError("");
    try { setResult(await onCommit(resolutions)); }
    catch (nextError) { setError(communityErrorMessage(nextError, "Couldn't combine your libraries yet. Nothing was removed. Please try again.")); }
    finally { setBusy(false); }
  };

  const downloadBackup = async () => {
    setBackingUp(true);
    setError("");
    try { await onDownloadBackup(); }
    catch (nextError) { setError(communityErrorMessage(nextError, "Couldn't download your backup. Please try again.")); }
    finally { setBackingUp(false); }
  };

  if (result) return (
    <section className={styles.mergeReview} aria-label="Library combination complete">
      <div className={styles.mergeSuccess}><ShieldCheck /><div><strong>Your Tagify libraries are combined.</strong><span>{result.additionsFromDevice.toLocaleString()} added from this device · {result.additionsFromCommunity.toLocaleString()} restored from Community · {result.conflictsResolved.toLocaleString()} differences resolved</span></div></div>
    </section>
  );

  return (
    <section className={styles.mergeReview} aria-labelledby="merge-review-title">
      <div className={styles.mergeReviewHeading}>
        <div>
          <p className={styles.mergeEyebrow}>Your choice is needed</p>
          <h3 id="merge-review-title">Combine your Tagify libraries</h3>
          <p>Tagify found saved music and settings on both this device and Community. Combining keeps items found on only one side. Your choices below apply only where both sides have different versions of the same item.</p>
        </div>
      </div>

      <div className={styles.mergeLibraryCards}>
        <LibraryCard title="This device" counts={review.device} />
        <LibraryCard title="Community" counts={review.community} />
      </div>

      <div className={styles.mergeSafeSummary}>
        <ShieldCheck size={18} />
        <span><strong>{(review.additionsFromDevice + review.additionsFromCommunity).toLocaleString()} items found on only one side will be kept.</strong> This includes {review.additionsFromCommunity.toLocaleString()} from Community that will be added to this device, no matter which choice you make below.</span>
      </div>

      {review.conflicts.length ? <>
        <div className={styles.mergeChoiceSection}>
          <div><strong>For the {review.conflicts.length.toLocaleString()} difference{review.conflicts.length === 1 ? "" : "s"}, which version should Tagify use?</strong><span>This does not replace either whole library. You can change individual choices below.</span></div>
          <div className={styles.mergeBulkChoices} role="radiogroup" aria-label="Default choice for differences">
            <ChoiceButton source="device" selected={bulkChoice === "device"} onClick={() => applyBulkChoice("device")} label="Use this device for differences" />
            <ChoiceButton source="community" selected={bulkChoice === "community"} onClick={() => applyBulkChoice("community")} label="Use Community for differences" />
          </div>
        </div>

        <div className={styles.mergeConflictToolbar}>
          <div className={styles.mergeFilters} aria-label="Filter differences">
            {(["all", "music", "organization", "playlists", "settings"] as ConflictFilter[]).map((value) => <button key={value} type="button" className={filter === value ? styles.mergeFilterActive : ""} onClick={() => setFilter(value)}>{filterLabel(value)}</button>)}
          </div>
          <label className={styles.mergeSearch}><Search size={14} /><span className={styles.srOnly}>Search differences</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search differences" /></label>
        </div>

        <div className={styles.mergeConflictList} aria-label="Library differences">
          {conflicts.length ? conflicts.map((conflict) => {
            const selected = overrides[conflict.id] || bulkChoice;
            return <article key={conflict.id} className={styles.mergeConflict}>
              <div className={styles.mergeConflictTitle}><strong>{review.labels[conflict.id] || conflictLabel(conflict)}</strong><span>{fieldLabel(conflict)}</span></div>
              <div className={styles.mergeConflictChoices}>
                <ValueChoice side="This device" value={describeConflictValue(conflict, "device", review.labels)} selected={selected === "device"} onClick={() => setOverrides((current) => ({ ...current, [conflict.id]: "device" }))} />
                <ValueChoice side="Community" value={describeConflictValue(conflict, "community", review.labels)} selected={selected === "community"} onClick={() => setOverrides((current) => ({ ...current, [conflict.id]: "community" }))} />
              </div>
            </article>;
          }) : <p className={styles.mergeEmpty}>No differences match this search.</p>}
        </div>
      </> : <div className={styles.mergeNoConflicts}><ShieldCheck /><span><strong>No conflicting choices were found.</strong> Tagify can safely keep everything from both libraries.</span></div>}

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {!review.supported ? <div className={styles.warning} role="status"><span><strong>Community is finishing an update before these libraries can be combined.</strong> Your Tagify data has not changed. Try again a little later.</span></div> : null}
      <div className={styles.mergeActions}>
        <button type="button" className={styles.secondary} disabled={busy || backingUp} onClick={() => void downloadBackup()}><Download size={15} /> {backingUp ? "Preparing backup…" : "Download backup first"}</button>
        <button type="button" className={styles.primary} disabled={!review.supported || busy || (review.conflicts.length > 0 && !bulkChoice)} onClick={() => void commit()}>{busy ? "Combining libraries…" : "Combine libraries"}</button>
      </div>
    </section>
  );
}

function LibraryCard({ title, counts }: { title: string; counts: InitialMergeReview["device"] }) {
  return <article><strong>{title}</strong><span>{counts.annotations.toLocaleString()} tagged items</span><span>{counts.taxonomy.toLocaleString()} tags and groups</span><span>{counts.smartPlaylists.toLocaleString()} Smart Playlists</span><span>{counts.savedSettings.toLocaleString()} saved preferences</span></article>;
}

function ChoiceButton({ source, selected, onClick, label }: { source: InitialMergeSource; selected: boolean; onClick: () => void; label: string }) {
  return <button type="button" role="radio" aria-checked={selected} data-source={source} className={selected ? styles.mergeChoiceSelected : ""} onClick={onClick}>{label}</button>;
}

function ValueChoice({ side, value, selected, onClick }: { side: string; value: string; selected: boolean; onClick: () => void }) {
  return <button type="button" aria-pressed={selected} className={selected ? styles.mergeValueSelected : ""} onClick={onClick}><span>{side}</span><strong>{value}</strong></button>;
}

function conflictCategory(conflict: InitialMergeConflictV1): ConflictFilter {
  if (["annotation-field", "tag-membership", "annotation-state"].includes(conflict.kind)) return "music";
  if (["taxonomy", "color", "collection"].includes(conflict.kind)) return "organization";
  if (conflict.kind === "smart-playlist") return "playlists";
  return "settings";
}

function filterLabel(filter: ConflictFilter) { return ({ all: "All", music: "Tagged items", organization: "Tags", playlists: "Smart Playlists", settings: "Settings" })[filter]; }
function conflictLabel(conflict: InitialMergeConflictV1) { return ({ "annotation-field": "Tagged item", "tag-membership": "Tag choice", "annotation-state": "Saved item", taxonomy: "Tag organization", color: "Tag color", collection: "Color collection", "smart-playlist": "Smart Playlist", "saved-setting": "Saved setting" })[conflict.kind]; }
function fieldLabel(conflict: InitialMergeConflictV1) { return conflict.field ? friendlyWords(conflict.field) : conflictLabel(conflict); }
function friendlyWords(value: string) { return value.replace(/^tagify:/, "").replace(/[-_:]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function describeConflictValue(conflict: InitialMergeConflictV1, source: InitialMergeSource, labels: Record<string, string>): string {
  const value = source === "device" ? conflict.deviceValue : conflict.communityValue;
  const otherValue = source === "device" ? conflict.communityValue : conflict.deviceValue;
  if (conflict.kind !== "taxonomy" || !isRecord(value) || !isRecord(otherValue)) return describeValue(value);

  const changed = new Set([...Object.keys(value), ...Object.keys(otherValue)].filter((key) => !sameValue(value[key], otherValue[key])));
  const parts = [typeof value.name === "string" ? value.name : "Tag organization"];
  if (changed.has("kind") && typeof value.kind === "string") parts.push(friendlyWords(value.kind));
  if (changed.has("parentId")) {
    const parentId = typeof value.parentId === "string" ? value.parentId : null;
    parts.push(parentId ? `Inside ${labels[`taxonomy-path:${source}:${parentId}`] || "another group"}` : "Top level");
  }
  if (changed.has("position") && typeof value.position === "number") parts.push(`Position ${value.position + 1}`);
  if (changed.has("accentId")) {
    const accentId = typeof value.accentId === "string" ? value.accentId : null;
    parts.push(accentId ? `Color: ${labels[`color:${source}:${accentId}`] || "Custom"}` : "Default color");
  }
  if (changed.has("deleted")) parts.push(value.deleted === true ? "Removed" : "Kept");
  return parts.join(" · ");
}

function describeValue(value: unknown): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  if (value === null || value === undefined || value === "") return "Not set";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return `${value.length} saved item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "object") {
    const item = value as Record<string, unknown>;
    if (typeof item.playlistName === "string") return `${item.playlistName}${item.isActive === false ? " (paused)" : ""}`;
    if (typeof item.name === "string") return item.name;
  }
  return "Different saved setup";
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function sameValue(left: unknown, right: unknown) { return JSON.stringify(left) === JSON.stringify(right); }

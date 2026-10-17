import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { PublicationPolicyV2 } from "@tagify/sync-contracts";
import { ChevronDown, ChevronRight, Folder, RefreshCw, Search, ShieldCheck, Tag } from "lucide-react";
import type { TagTaxonomy } from "@/types/tagData";
import { storageService } from "@/services/storage/StorageService";
import { syncRuntime } from "@/services/sync/SyncRuntime";
// eslint-disable-next-line css-modules/no-unused-class -- shared with the Cloud Sync and setup dialogs
import styles from "./CloudSyncModal.module.css";
import { communityErrorMessage } from "./communitySyncCopy";
import {
  buildVisibilityTree,
  changePublication,
  fetchPublicationPolicy,
  keepTagsPrivate,
  publicationState,
  savePublicationPolicy,
  type PublicationState,
  type VisibilityBranch,
} from "./communityPublication";

type Notice = { tone: "success" | "error"; text: string };

const SUMMARY_TEXT: Record<PublicationState, string> = {
  review: "Review what will be public, then publish. Any tag or folder you hide stays private.",
  public: "Everything is shared by default. Choose a tag or folder only if you want to keep it private.",
  private: "Your tags aren't public. Tagify keeps backing up your library. Publish whenever you like; tags you hide stay private.",
  paused: "Your profile still shows your tags from before you paused. New changes stay private until you resume.",
};

export function CommunityVisibilityReview({ connected, onSaved, onReviewStateChange }: { connected: boolean; onSaved?: (policy: PublicationPolicyV2) => void; onReviewStateChange?: (reviewed: boolean | null) => void }) {
  const [policy, setPolicy] = useState<PublicationPolicyV2 | null>(null);
  const [savedChoices, setSavedChoices] = useState("");
  const [taxonomy, setTaxonomy] = useState<TagTaxonomy | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmingStop, setConfirmingStop] = useState(false);
  const [search, setSearch] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    setNotice(null);
    try {
      const [nextPolicy, localTaxonomy] = await Promise.all([
        fetchPublicationPolicy(),
        storageService.getTaxonomy(),
      ]);
      setPolicy(nextPolicy);
      setSavedChoices(visibilityChoices(nextPolicy));
      setTaxonomy(localTaxonomy);
      setExpandedNodeIds(new Set());
      const reviewed = Boolean(nextPolicy.reviewedAt);
      onReviewStateChange?.(reviewed);
      if (!reviewed) setIsExpanded(true);
    } catch (error) {
      onReviewStateChange?.(null);
      setNotice({ tone: "error", text: communityErrorMessage(error, "Couldn't load your sharing choices. Please try again.") });
    } finally {
      setLoading(false);
    }
  }, [connected, onReviewStateChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const choices = policy ? visibilityChoices(policy) : "";
  const hasUnsavedChoices = choices !== savedChoices;
  useEffect(() => {
    if (policy) onReviewStateChange?.(Boolean(policy.reviewedAt) && !hasUnsavedChoices);
  }, [policy, hasUnsavedChoices, onReviewStateChange]);

  const fullTree = useMemo(() => taxonomy ? buildVisibilityTree(taxonomy) : [], [taxonomy]);
  const tree = useMemo(() => filterTree(fullTree, search), [fullTree, search]);
  const hiddenTagIds = useMemo(() => new Set(policy?.hiddenTagIds || []), [policy]);
  const hiddenNodeIds = useMemo(() => new Set(policy?.hiddenNodeIds || []), [policy]);
  const totalTagCount = useMemo(() => taxonomy ? Object.keys(taxonomy.tagsById).length : 0, [taxonomy]);
  const hiddenTagCount = useMemo(() => {
    if (!policy) return 0;
    return fullTree.reduce((count, node) => count + visibilityStatus(node, hiddenTagIds, hiddenNodeIds).hiddenCount, 0);
  }, [fullTree, hiddenNodeIds, hiddenTagIds, policy]);

  const toggleBranch = (node: VisibilityBranch, hidden: boolean) => {
    setPolicy((current) => {
      if (!current) return current;
      const nextHiddenTags = new Set(current.hiddenTagIds);
      const nextHiddenNodes = new Set(current.hiddenNodeIds);
      const branchTagIds = tagIdsInBranch(node);
      if (node.kind === "tag") {
        if (hidden) nextHiddenTags.add(node.id);
        else nextHiddenTags.delete(node.id);
      } else if (hidden) {
        nextHiddenNodes.add(node.id);
        branchTagIds.forEach((id) => nextHiddenTags.delete(id));
      } else {
        taxonomyNodeIdsInBranch(node).forEach((id) => nextHiddenNodes.delete(id));
        branchTagIds.forEach((id) => nextHiddenTags.delete(id));
      }
      return { ...current, hiddenTagIds: [...nextHiddenTags].sort(), hiddenNodeIds: [...nextHiddenNodes].sort() };
    });
  };

  const apply = async (change: (current: PublicationPolicyV2) => Promise<PublicationPolicyV2>, successText: string, failureText: string) => {
    if (!policy) return;
    setSaving(true);
    setNotice(null);
    try {
      const savedPolicy = await change(policy);
      setPolicy(savedPolicy);
      setSavedChoices(visibilityChoices(savedPolicy));
      setConfirmingStop(false);
      onReviewStateChange?.(Boolean(savedPolicy.reviewedAt));
      onSaved?.(savedPolicy);
      setNotice({ tone: "success", text: successText });
      void syncRuntime.syncNow();
    } catch (error) {
      setNotice({ tone: "error", text: communityErrorMessage(error, failureText) });
    } finally {
      setSaving(false);
    }
  };

  const publish = () => apply((current) => savePublicationPolicy(current, { enabled: true }), "Publishing your tags. Your profile updates within a minute.", "Couldn't publish your tags. Please try again.");
  const saveChoices = () => apply((current) => savePublicationPolicy(current), "Saved. Your profile updates within a minute.", "Couldn't save your sharing choices. Please try again.");
  const keepPrivate = () => apply(keepTagsPrivate, "Your tags stay private. You can publish them here any time.", "Couldn't save your choice. Please try again.");
  const stopSharing = () => apply((current) => changePublication(current, "unpublish"), "Your profile is no longer public. Backup keeps running.", "Couldn't take down your profile. Please try again.");
  const resume = () => apply((current) => changePublication(current, "resume"), "Updates resumed. Your profile catches up within a minute.", "Couldn't resume updates. Please try again.");

  if (!connected) return null;

  const state = policy ? publicationState(policy) : null;
  const visibilitySummary = state === "review" ? "Review required"
    : state === "private" ? "Not public"
    : state === "paused" ? "Updates paused"
    : hiddenTagCount > 0 ? "Custom visibility" : "Sharing all tags";
  const busy = saving || loading;

  return <section className={`${styles.visibilityPanel} ${isExpanded ? styles.visibilityPanelExpanded : ""}`}>
    <button
      type="button"
      className={styles.visibilityDisclosure}
      aria-expanded={isExpanded}
      aria-controls="community-public-visibility-controls"
      onClick={() => setIsExpanded((current) => !current)}
    >
      <span><strong><ShieldCheck size={16} /> Public visibility</strong>{policy ? <small>{visibilitySummary}</small> : null}</span>
      {isExpanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
    </button>
    {isExpanded ? <div id="community-public-visibility-controls" className={styles.visibilityContent}>
      {loading && !policy ? <p>Loading visibility settings...</p> : null}
      {policy && state ? <>
        <p className={styles.visibilitySummary}>{SUMMARY_TEXT[state]}</p>
        {totalTagCount > 0 ? <>
          <div className={styles.visibilityToolbar}>
            <label className={styles.searchBox}><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tags and folders" /></label>
            <button type="button" className={styles.visibilityReloadButton} onClick={() => void load()} disabled={busy} title="Reload public visibility" aria-label="Reload public visibility"><RefreshCw size={14} /></button>
            <div className={styles.visibilityTreeActions}>
              <button type="button" onClick={() => setExpandedNodeIds(new Set(expandableIdsInTree(fullTree)))}>Expand all</button>
              <button type="button" onClick={() => setExpandedNodeIds(new Set())}>Collapse all</button>
            </div>
          </div>
          <div className={styles.visibilityTree} role="region" aria-label="Tag exclusion choices" tabIndex={0}>
            {tree.length ? tree.map((node) => <VisibilityTreeNode key={node.id} node={node} hiddenTags={hiddenTagIds} hiddenNodes={hiddenNodeIds} expandedNodeIds={expandedNodeIds} searchActive={Boolean(search.trim())} onToggleExpanded={(id) => setExpandedNodeIds((current) => toggleExpanded(current, id))} onToggle={toggleBranch} />) : <p>No local tags match this search.</p>}
          </div>
        </> : <p>No local tags have synced yet.</p>}
        {confirmingStop ? <div className={styles.visibilityConfirm} role="group" aria-labelledby="community-stop-sharing-title">
          <div><strong id="community-stop-sharing-title">Take down your public profile?</strong><span>Your private cloud backup keeps running.</span></div>
          <div className={styles.visibilityActions}>
            <button type="button" className={styles.secondary} onClick={() => setConfirmingStop(false)} disabled={saving}>Cancel</button>
            <button type="button" className={styles.primary} onClick={() => void stopSharing()} disabled={saving}>{saving ? "Taking down..." : "Stop sharing"}</button>
          </div>
        </div> : <div className={styles.visibilityActions}>
          {state === "review" || state === "private" ? <button type="button" className={styles.primary} onClick={() => void publish()} disabled={busy}>{saving ? "Saving..." : "Publish my tags"}</button> : null}
          {state === "review" ? <button type="button" className={styles.quietAction} onClick={() => void keepPrivate()} disabled={busy}>Keep my tags private</button> : null}
          {state === "private" && hasUnsavedChoices ? <button type="button" className={styles.secondary} onClick={() => void saveChoices()} disabled={busy}>Save without publishing</button> : null}
          {state === "paused" ? <button type="button" className={styles.primary} onClick={() => void resume()} disabled={busy}>{saving ? "Saving..." : "Resume updates"}</button> : null}
          {state === "public" || state === "paused" ? <button type="button" className={state === "public" ? styles.primary : styles.secondary} onClick={() => void saveChoices()} disabled={busy || !hasUnsavedChoices}>{saving && state === "public" ? "Saving..." : "Save visibility"}</button> : null}
          {state === "public" ? <button type="button" className={styles.quietAction} onClick={() => setConfirmingStop(true)} disabled={busy}>Stop sharing</button> : null}
        </div>}
      </> : null}
      {notice ? <div className={notice.tone === "success" ? styles.success : styles.error} role="status">{notice.text}</div> : null}
    </div> : null}
  </section>;
}

function visibilityChoices(policy: PublicationPolicyV2): string {
  return JSON.stringify([[...policy.hiddenTagIds].sort(), [...policy.hiddenNodeIds].sort()]);
}

function filterTree(nodes: VisibilityBranch[], search: string): VisibilityBranch[] {
  const query = search.trim().toLowerCase();
  if (!query) return nodes;
  return nodes.flatMap((node) => {
    const children = filterTree(node.children, search);
    return node.name.toLowerCase().includes(query) || children.length ? [{ ...node, children }] : [];
  });
}

function tagIdsInBranch(node: VisibilityBranch): string[] {
  return [...(node.kind === "tag" ? [node.id] : []), ...node.children.flatMap(tagIdsInBranch)];
}

function taxonomyNodeIdsInBranch(node: VisibilityBranch): string[] {
  return [...(node.kind !== "tag" ? [node.id] : []), ...node.children.flatMap(taxonomyNodeIdsInBranch)];
}

function expandableIdsInTree(nodes: VisibilityBranch[]): string[] {
  return nodes.flatMap((node) => [
    ...(node.children.length ? [node.id] : []),
    ...expandableIdsInTree(node.children),
  ]);
}

function visibilityStatus(node: VisibilityBranch, hiddenTags: Set<string>, hiddenNodes: Set<string>, ancestorHidden = false): { hiddenCount: number; tagCount: number } {
  const hiddenByBranch = ancestorHidden || hiddenNodes.has(node.id);
  if (node.kind === "tag") return { hiddenCount: hiddenByBranch || hiddenTags.has(node.id) ? 1 : 0, tagCount: 1 };
  return node.children.reduce((total, child) => {
    const childStatus = visibilityStatus(child, hiddenTags, hiddenNodes, hiddenByBranch);
    return { hiddenCount: total.hiddenCount + childStatus.hiddenCount, tagCount: total.tagCount + childStatus.tagCount };
  }, { hiddenCount: 0, tagCount: 0 });
}

function toggleExpanded(current: Set<string>, id: string) {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function VisibilityTreeNode({ node, hiddenTags, hiddenNodes, expandedNodeIds, searchActive, onToggleExpanded, onToggle, ancestorHidden = false }: { node: VisibilityBranch; hiddenTags: Set<string>; hiddenNodes: Set<string>; expandedNodeIds: Set<string>; searchActive: boolean; onToggleExpanded: (id: string) => void; onToggle: (node: VisibilityBranch, hidden: boolean) => void; ancestorHidden?: boolean }) {
  const branchHidden = ancestorHidden || hiddenNodes.has(node.id);
  const status = visibilityStatus(node, hiddenTags, hiddenNodes, ancestorHidden);
  const allHidden = status.tagCount > 0 && status.hiddenCount === status.tagCount;
  const partlyHidden = status.hiddenCount > 0 && !allHidden;
  const label = node.kind === "tag" ? (allHidden ? "Excluded" : "Publishes") : `${status.hiddenCount} of ${status.tagCount} excluded`;
  const canExpand = node.children.length > 0;
  const expanded = searchActive || expandedNodeIds.has(node.id);
  return <div className={styles.visibilityNode}>
    <div className={styles.visibilityNodeRow}>
      <button type="button" className={styles.visibilityExpandButton} onClick={() => onToggleExpanded(node.id)} disabled={!canExpand} aria-label={`${expanded ? "Collapse" : "Expand"} ${node.name}`}>
        {canExpand ? expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} /> : node.kind === "tag" ? <Tag size={14} /> : <Folder size={14} />}
      </button>
      <input className={styles.visibilityCheckbox} type="checkbox" checked={allHidden} disabled={status.tagCount === 0 || ancestorHidden} aria-label={`Exclude ${node.name}: ${label}`} ref={(input) => { if (input) input.indeterminate = partlyHidden; }} onChange={(event) => onToggle(node, event.target.checked)} />
      <button type="button" className={styles.visibilityNodeLabel} onClick={() => canExpand ? onToggleExpanded(node.id) : undefined} disabled={!canExpand}>
        <strong>{node.name}</strong><small>{ancestorHidden ? "Hidden by parent" : label}</small>
      </button>
    </div>
    {expanded ? <div className={styles.visibilityChildren}>{node.children.map((child) => <VisibilityTreeNode key={child.id} node={child} hiddenTags={hiddenTags} hiddenNodes={hiddenNodes} expandedNodeIds={expandedNodeIds} searchActive={searchActive} onToggleExpanded={onToggleExpanded} onToggle={onToggle} ancestorHidden={branchHidden} />)}</div> : null}
  </div>;
}

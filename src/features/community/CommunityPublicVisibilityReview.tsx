import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { PublicationPolicyV2 } from "@tagify/sync-contracts";
import { ChevronDown, ChevronRight, Folder, RefreshCw, Search, ShieldCheck, Tag } from "lucide-react";
import type { TagTaxonomy, TaxonomyTag } from "@/types/tagData";
import { storageService } from "@/services/storage/StorageService";
import { syncRuntime } from "@/services/sync/SyncRuntime";
import { normalizeTaxonomyTree } from "@/utils/tagTaxonomy";
import styles from "./CloudSyncModal.module.css";
import { communityErrorMessage } from "./communitySyncCopy";

interface VisibilityBranch {
  id: string;
  kind: "category" | "folder" | "tag";
  name: string;
  children: VisibilityBranch[];
}

export function CommunityVisibilityReview({ connected, onSaved, onReviewStateChange }: { connected: boolean; onSaved?: (policy: PublicationPolicyV2) => void; onReviewStateChange?: (reviewed: boolean | null) => void }) {
  const [policy, setPolicy] = useState<PublicationPolicyV2 | null>(null);
  const [savedChoices, setSavedChoices] = useState("");
  const [taxonomy, setTaxonomy] = useState<TagTaxonomy | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    setMessage("");
    try {
      const [policyBody, localTaxonomy] = await Promise.all([
        syncRuntime.communityRequest("/api/v2/publication-policy"),
        storageService.getTaxonomy(),
      ]);
      const nextPolicy = normalizePolicy(policyBody.policy as PublicationPolicyV2);
      setPolicy(nextPolicy);
      setSavedChoices(visibilityChoices(nextPolicy));
      setTaxonomy(localTaxonomy);
      setExpandedNodeIds(new Set());
      const reviewed = Boolean(nextPolicy.reviewedAt);
      onReviewStateChange?.(reviewed);
      if (!reviewed) setIsExpanded(true);
    } catch (error) {
      onReviewStateChange?.(null);
      setMessage(communityErrorMessage(error, "Couldn't load your sharing choices. Please try again."));
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
    if (!taxonomy || !policy) return 0;
    const roots = buildVisibilityTree(taxonomy);
    return roots.reduce((count, node) => count + visibilityStatus(node, hiddenTagIds, hiddenNodeIds).hiddenCount, 0);
  }, [hiddenNodeIds, hiddenTagIds, policy, taxonomy]);

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

  const save = async () => {
    if (!policy) return;
    setSaving(true);
    setMessage("");
    try {
      const nextPolicy = normalizePolicy({ ...policy, reviewedAt: new Date().toISOString() });
      const body = await syncRuntime.communityRequest("/api/v2/publication-policy", {
        method: "PUT",
        body: { policy: nextPolicy, expectedRevision: policy.revision },
      });
      const savedPolicy = normalizePolicy(body.policy as PublicationPolicyV2);
      setPolicy(savedPolicy);
      setSavedChoices(visibilityChoices(savedPolicy));
      onReviewStateChange?.(Boolean(savedPolicy.reviewedAt));
      onSaved?.(savedPolicy);
      setMessage("Public visibility saved. Sync will publish using these rules.");
      void syncRuntime.syncNow();
    } catch (error) {
      setMessage(communityErrorMessage(error, "Couldn't save your sharing choices. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  if (!connected) return null;

  const needsReview = Boolean(policy && !policy.reviewedAt);
  const visibilitySummary = needsReview ? "Review required" : hiddenTagCount > 0 ? "Custom visibility" : "Sharing all tags";

  return <section className={`${styles.visibilityPanel} ${isExpanded ? styles.visibilityPanelExpanded : ""}`}>
    <button
      type="button"
      className={styles.visibilityDisclosure}
      aria-expanded={isExpanded}
      aria-controls="community-public-visibility-controls"
      onClick={() => setIsExpanded((current) => !current)}
    >
      <span><strong><ShieldCheck size={16} /> Public visibility</strong><small>{visibilitySummary}</small></span>
      {isExpanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
    </button>
    {isExpanded ? <div id="community-public-visibility-controls" className={styles.visibilityContent}>
      {loading && !policy ? <p>Loading visibility settings...</p> : null}
      {policy ? <>
        <p className={styles.visibilitySummary}>{needsReview ? "Review what will be public, then save once to publish your profile." : "Everything is shared by default. Choose a tag or folder only if you want to keep it private."}</p>
        {totalTagCount > 0 ? <>
          <div className={styles.visibilityToolbar}>
            <label className={styles.searchBox}><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tags and folders" /></label>
            <button type="button" className={styles.visibilityReloadButton} onClick={() => void load()} disabled={loading || saving} title="Reload public visibility" aria-label="Reload public visibility"><RefreshCw size={14} /></button>
            <div className={styles.visibilityTreeActions}>
              <button type="button" onClick={() => setExpandedNodeIds(new Set(expandableIdsInTree(fullTree)))}>Expand all</button>
              <button type="button" onClick={() => setExpandedNodeIds(new Set())}>Collapse all</button>
            </div>
          </div>
          <div className={styles.visibilityTree} role="region" aria-label="Tag exclusion choices" tabIndex={0}>
            {tree.length ? tree.map((node) => <VisibilityTreeNode key={node.id} node={node} hiddenTags={hiddenTagIds} hiddenNodes={hiddenNodeIds} expandedNodeIds={expandedNodeIds} searchActive={Boolean(search.trim())} onToggleExpanded={(id) => setExpandedNodeIds((current) => toggleExpanded(current, id))} onToggle={toggleBranch} />) : <p>No local tags match this search.</p>}
          </div>
        </> : <p>No local tags have synced yet.</p>}
        <button type="button" className={styles.primary} onClick={() => void save()} disabled={saving || loading || (!needsReview && !hasUnsavedChoices)}>{saving ? "Saving..." : "Save visibility"}</button>
      </> : null}
      {message ? <div className={message.includes("saved") ? styles.success : styles.error} role="status">{message}</div> : null}
    </div> : null}
  </section>;
}

function visibilityChoices(policy: PublicationPolicyV2): string {
  return JSON.stringify([[...policy.hiddenTagIds].sort(), [...policy.hiddenNodeIds].sort()]);
}

function normalizePolicy(policy: PublicationPolicyV2): PublicationPolicyV2 {
  return {
    ...policy,
    enabled: true,
    shareTaxonomy: true,
    hiddenNodeIds: Array.isArray(policy.hiddenNodeIds) ? policy.hiddenNodeIds : [],
    entities: {
      track: { ...policy.entities.track, tags: true },
      album: { ...policy.entities.album, tags: true },
      artist: { ...policy.entities.artist, tags: true },
    },
  };
}

function buildVisibilityTree(taxonomy: TagTaxonomy): VisibilityBranch[] {
  const normalized = normalizeTaxonomyTree(taxonomy);
  const visit = (id: string): VisibilityBranch | null => {
    const category = normalized.categoriesById[id];
    const folder = normalized.subcategoriesById[id];
    const tag = normalized.tagsById[id];
    if (category) return { id: category.id, kind: "category", name: category.name, children: (normalized.childrenByParentId?.[id] || category.subcategoryIds || []).map(visit).filter(Boolean) as VisibilityBranch[] };
    if (folder) return { id: folder.id, kind: "folder", name: folder.name, children: (normalized.childrenByParentId?.[id] || folder.childIds || folder.tagIds || []).map(visit).filter(Boolean) as VisibilityBranch[] };
    if (tag) return { id: tag.id, kind: "tag", name: tag.name, children: [] };
    return null;
  };
  const rootIds = normalized.categoryOrder.length ? normalized.categoryOrder : Object.values(normalized.tagsById).filter(isRootTag).map((tag) => tag.id);
  return rootIds.map(visit).filter(Boolean) as VisibilityBranch[];
}

function isRootTag(tag: TaxonomyTag): boolean {
  return !tag.parentId;
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

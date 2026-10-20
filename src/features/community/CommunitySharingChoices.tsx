import React, { useMemo, useState } from "react";
import type { PublicationPolicyV2 } from "@tagify/sync-contracts";
import { ChevronDown, ChevronRight, Folder, Search, Tag } from "lucide-react";
import type { TagTaxonomy } from "@/types/tagData";
// eslint-disable-next-line css-modules/no-unused-class -- shared with the Cloud Sync and setup dialogs
import styles from "./CloudSyncModal.module.css";
import { buildVisibilityTree, type VisibilityBranch } from "./communityPublication";

export type SharingChoices = Pick<PublicationPolicyV2, "hiddenTagIds" | "hiddenNodeIds">;

/**
 * The list of tags and folders a member can hide from their profile. A checked
 * box hides a tag, or a folder with everything in it.
 */
export function CommunitySharingChoices({ taxonomy, choices, published, disabled = false, onChange }: {
  taxonomy: TagTaxonomy;
  choices: SharingChoices;
  /** Whether the profile is public now, so unhidden tags read "Public" rather than "Will be public". */
  published: boolean;
  disabled?: boolean;
  onChange: (next: SharingChoices) => void;
}) {
  const [search, setSearch] = useState("");
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(() => new Set());
  const fullTree = useMemo(() => buildVisibilityTree(taxonomy), [taxonomy]);
  const tree = useMemo(() => filterTree(fullTree, search), [fullTree, search]);
  const hiddenTags = useMemo(() => new Set(choices.hiddenTagIds), [choices.hiddenTagIds]);
  const hiddenNodes = useMemo(() => new Set(choices.hiddenNodeIds), [choices.hiddenNodeIds]);

  const toggle = (node: VisibilityBranch, makePublic: boolean) => {
    const nextHiddenTags = new Set(choices.hiddenTagIds);
    const nextHiddenNodes = new Set(choices.hiddenNodeIds);
    const branchTagIds = tagIdsInBranch(node);
    if (node.kind === "tag") {
      if (makePublic) nextHiddenTags.delete(node.id);
      else nextHiddenTags.add(node.id);
    } else if (makePublic) {
      taxonomyNodeIdsInBranch(node).forEach((id) => nextHiddenNodes.delete(id));
      branchTagIds.forEach((id) => nextHiddenTags.delete(id));
    } else {
      nextHiddenNodes.add(node.id);
      branchTagIds.forEach((id) => nextHiddenTags.delete(id));
    }
    onChange({ hiddenTagIds: [...nextHiddenTags].sort(), hiddenNodeIds: [...nextHiddenNodes].sort() });
  };

  if (!fullTree.length) return <p className={styles.visibilitySummary}>You don't have any tags yet.</p>;

  return <div className={styles.sharingChoices}>
    <div className={styles.visibilityToolbar}>
      <label className={styles.searchBox}><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tags and folders" aria-label="Search tags and folders" /></label>
      <div className={styles.visibilityTreeActions}>
        <button type="button" onClick={() => setExpandedNodeIds(new Set(expandableIdsInTree(fullTree)))}>Expand all</button>
        <button type="button" onClick={() => setExpandedNodeIds(new Set())}>Collapse all</button>
      </div>
    </div>
    <p className={styles.visibilitySummary}>Check a tag or folder to hide it from your profile.</p>
    <div className={styles.visibilityTree} role="region" aria-label="Choose which tags are hidden" tabIndex={0}>
      {tree.length ? tree.map((node) => <SharingChoiceNode key={node.id} node={node} hiddenTags={hiddenTags} hiddenNodes={hiddenNodes} published={published} disabled={disabled} expandedNodeIds={expandedNodeIds} searchActive={Boolean(search.trim())} onToggleExpanded={(id) => setExpandedNodeIds((current) => toggleExpanded(current, id))} onToggle={toggle} />) : <p>No tags match this search.</p>}
    </div>
  </div>;
}

export function sameChoices(left: SharingChoices, right: SharingChoices): boolean {
  return choicesKey(left) === choicesKey(right);
}

function choicesKey(choices: SharingChoices): string {
  return JSON.stringify([[...choices.hiddenTagIds].sort(), [...choices.hiddenNodeIds].sort()]);
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

function shareStatus(node: VisibilityBranch, hiddenTags: Set<string>, hiddenNodes: Set<string>, ancestorHidden = false): { publicCount: number; tagCount: number } {
  const hiddenByBranch = ancestorHidden || hiddenNodes.has(node.id);
  if (node.kind === "tag") return { publicCount: hiddenByBranch || hiddenTags.has(node.id) ? 0 : 1, tagCount: 1 };
  return node.children.reduce((total, child) => {
    const childStatus = shareStatus(child, hiddenTags, hiddenNodes, hiddenByBranch);
    return { publicCount: total.publicCount + childStatus.publicCount, tagCount: total.tagCount + childStatus.tagCount };
  }, { publicCount: 0, tagCount: 0 });
}

function toggleExpanded(current: Set<string>, id: string) {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function SharingChoiceNode({ node, hiddenTags, hiddenNodes, published, disabled, expandedNodeIds, searchActive, onToggleExpanded, onToggle, ancestorHidden = false }: { node: VisibilityBranch; hiddenTags: Set<string>; hiddenNodes: Set<string>; published: boolean; disabled: boolean; expandedNodeIds: Set<string>; searchActive: boolean; onToggleExpanded: (id: string) => void; onToggle: (node: VisibilityBranch, makePublic: boolean) => void; ancestorHidden?: boolean }) {
  const branchHidden = ancestorHidden || hiddenNodes.has(node.id);
  const status = shareStatus(node, hiddenTags, hiddenNodes, ancestorHidden);
  const hiddenCount = status.tagCount - status.publicCount;
  const allHidden = status.tagCount > 0 && hiddenCount === status.tagCount;
  const partlyHidden = hiddenCount > 0 && !allHidden;
  const label = ancestorHidden ? "Hidden with its folder"
    : node.kind === "tag" ? (allHidden ? "Hidden" : published ? "Public" : "Will be public")
    : allHidden ? `All ${status.tagCount} hidden`
    : hiddenCount ? `${hiddenCount} of ${status.tagCount} hidden`
    : `All ${status.tagCount} ${published ? "public" : "will be public"}`;
  const canExpand = node.children.length > 0;
  const expanded = searchActive || expandedNodeIds.has(node.id);
  return <div className={styles.visibilityNode}>
    <div className={`${styles.visibilityNodeRow} ${allHidden ? styles.visibilityNodeRowHidden : ""}`}>
      <button type="button" className={styles.visibilityExpandButton} onClick={() => onToggleExpanded(node.id)} disabled={!canExpand} aria-label={`${expanded ? "Collapse" : "Expand"} ${node.name}`}>
        {canExpand ? expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} /> : node.kind === "tag" ? <Tag size={14} /> : <Folder size={14} />}
      </button>
      <input className={styles.visibilityCheckbox} type="checkbox" checked={allHidden} disabled={disabled || status.tagCount === 0 || ancestorHidden} aria-label={`Hide ${node.name} from your profile`} aria-describedby={`sharing-choice-${node.id}`} ref={(input) => { if (input) input.indeterminate = partlyHidden; }} onChange={(event) => onToggle(node, !event.target.checked)} />
      <button type="button" className={styles.visibilityNodeLabel} onClick={() => canExpand ? onToggleExpanded(node.id) : undefined} disabled={!canExpand}>
        <strong>{node.name}</strong><small id={`sharing-choice-${node.id}`}>{label}</small>
      </button>
    </div>
    {expanded ? <div className={styles.visibilityChildren}>{node.children.map((child) => <SharingChoiceNode key={child.id} node={child} hiddenTags={hiddenTags} hiddenNodes={hiddenNodes} published={published} disabled={disabled} expandedNodeIds={expandedNodeIds} searchActive={searchActive} onToggleExpanded={onToggleExpanded} onToggle={onToggle} ancestorHidden={branchHidden} />)}</div> : null}
  </div>;
}

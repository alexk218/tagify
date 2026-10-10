import React, { useMemo } from "react";
import { Check, Plus } from "lucide-react";
import type { AlbumTrackSummary, TagTaxonomy } from "@/types/tagData";
import { buildResolvedTagLookup } from "@/utils/tagTaxonomy";
import { buildTagAccentCssVars } from "@/features/tag-data/utils/tagAccent";
import styles from "./SuggestedTrackTags.module.css";

interface Props {
  summary: AlbumTrackSummary;
  taxonomy: TagTaxonomy;
  entityLabel: "album" | "artist" | "playlist";
  appliedTagIds?: readonly string[];
  onAddTag: (tagId: string) => void;
  partial?: boolean;
}

export function SuggestedTrackTags({ summary, taxonomy, entityLabel, appliedTagIds = [], onAddTag,
  partial = false }: Props) {
  const lookup = useMemo(() => buildResolvedTagLookup(taxonomy), [taxonomy]);
  const tags = summary.commonTags.flatMap((tag) => {
    const resolved = lookup.get(tag.tagId);
    return resolved ? [{ ...tag, resolved }] : [];
  });
  if (!tags.length) return null;

  return <section className={styles.suggestions} aria-label="Suggested tags">
    <div className={styles.header}>
      <span className={styles.heading}>Suggested tags</span>
      <span className={styles.help}>From {partial ? "your checked tracks" : "your tracks"}. Add the ones that fit this {entityLabel}.</span>
    </div>
    <div className={styles.tags} aria-label="Common tags on your tracks">
      {tags.map(({ tagId, trackCount, resolved }) => {
        const added = appliedTagIds.includes(tagId);
        const coverage = `On ${trackCount} of ${summary.taggedTrackCount} ${partial ? "checked " : ""}tracks you've rated or tagged.`;
        return <div key={tagId} className={`${styles.tagGroup} ${resolved.tag.accentId ? styles.accented : ""}`}
          style={buildTagAccentCssVars(resolved.tag.accentId ?? null, taxonomy.customAccentsById)}>
          <button type="button" className={styles.add} disabled={added}
            aria-label={added ? `${resolved.name} added to this ${entityLabel}` : `Add ${resolved.name} to this ${entityLabel}`}
            title={`${coverage} ${added ? `Already added to this ${entityLabel}.` : `Add to this ${entityLabel}.`}`}
            onClick={(event) => { event.stopPropagation(); if (!added) onAddTag(tagId); }}>
            <span className={styles.name}>{resolved.name}</span>
            <span className={styles.count} aria-label={`${trackCount} tracks`}>{trackCount}</span>
            <span className={styles.action}>{added ? <Check size={12} aria-hidden="true" /> : <Plus size={12} aria-hidden="true" />}{added ? "Added" : "Add"}</span>
          </button>
        </div>;
      })}
    </div>
  </section>;
}

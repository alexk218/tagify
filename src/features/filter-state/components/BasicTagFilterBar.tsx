import React from "react";
import { TagAccentId } from "@/types/tagData";
import {
  TAG_FILTER_OPERATORS,
  TagFilterOperator,
} from "@/utils/tagFilterGroups";
import { buildTagAccentCssVars } from "@/features/tag-data";
import styles from "./BasicTagFilterBar.module.css";

export interface BasicAppliedTagFilter {
  id: string;
  name: string;
  accentId: TagAccentId | null;
  excluded: boolean;
}

interface BasicTagFilterBarProps {
  appliedTags: BasicAppliedTagFilter[];
  operator: TagFilterOperator;
  customAccentsById: Parameters<typeof buildTagAccentCssVars>[1];
  onRemoveTag: (tagId: string) => void;
  onSetOperator: (operator: TagFilterOperator) => void;
}

const BasicTagFilterBar: React.FC<BasicTagFilterBarProps> = ({
  appliedTags,
  operator,
  customAccentsById,
  onRemoveTag,
  onSetOperator,
}) => (
  <div className={styles.bar}>
    <div className={styles.appliedFilters} aria-label="Applied tag filters">
      <span className={styles.label}>Applied filters</span>
      <div className={styles.chips}>
        {appliedTags.length > 0 ? (
          appliedTags.map((tag) => (
            <button
              key={`${tag.excluded ? "exclude" : "include"}-${tag.id}`}
              className={`${styles.chip} ${tag.excluded ? styles.chipExcluded : ""} ${
                tag.accentId ? styles.chipAccented : ""
              }`}
              style={buildTagAccentCssVars(tag.accentId, customAccentsById)}
              onClick={() => onRemoveTag(tag.id)}
              aria-label={`Remove ${tag.excluded ? "excluded" : "included"} filter "${tag.name}"`}
              title={`Remove "${tag.name}" filter`}
            >
              {tag.name}
            </button>
          ))
        ) : (
          <span className={styles.empty}>No tag filters applied</span>
        )}
      </div>
    </div>
    <div className={styles.operatorToggle} aria-label="Tag filter matching">
      <button
        className={`${styles.operatorButton} ${
          operator === TAG_FILTER_OPERATORS.OR ? styles.operatorButtonActive : ""
        }`}
        aria-pressed={operator === TAG_FILTER_OPERATORS.OR}
        onClick={() => onSetOperator(TAG_FILTER_OPERATORS.OR)}
      >
        Match Any
      </button>
      <button
        className={`${styles.operatorButton} ${
          operator === TAG_FILTER_OPERATORS.AND ? styles.operatorButtonActive : ""
        }`}
        aria-pressed={operator === TAG_FILTER_OPERATORS.AND}
        onClick={() => onSetOperator(TAG_FILTER_OPERATORS.AND)}
      >
        Match All
      </button>
    </div>
  </div>
);

export default BasicTagFilterBar;

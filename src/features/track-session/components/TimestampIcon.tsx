import React from "react";
import { CalendarPlus, PencilLine } from "lucide-react";
import { formatTimestamp } from "@/utils/formatters";
import styles from "./TrackList.module.css";

export type TimestampKind = "created" | "updated";

const LABELS: Record<TimestampKind, string> = { created: "Created", updated: "Last updated" };

/** Small icon in front of a track row's created / last-updated date. `label` names the date too, since
 *  the icon's own tooltip is the one that shows when it's hovered (and the only thing left when crowded). */
export function TimestampIcon({ kind, label = LABELS[kind] }: { kind: TimestampKind; label?: string }) {
  const Icon = kind === "created" ? CalendarPlus : PencilLine;
  return (
    <span className={styles.timestampIcon} role="img" aria-label={label} title={label}>
      <Icon size={11} strokeWidth={2} aria-hidden="true" />
    </span>
  );
}

/** A track row's created and last-updated dates, each with its icon; the full date and time on hover. */
export function RowTimestamps({ created, modified, className }: { created?: number; modified?: number; className?: string }) {
  return (
    <div className={`${styles.trackItemTimestampsInline} ${className ?? ""}`}>
      {created ? (
        <div className={styles.timestampWithIcon} title={`Created: ${new Date(created).toLocaleString()}`}>
          <TimestampIcon kind="created" label={`Created: ${new Date(created).toLocaleString()}`} />
          <span className={styles.trackItemTimestamp}>{formatTimestamp(created)}</span>
        </div>
      ) : null}
      {modified ? (
        <div className={styles.timestampWithIcon} title={`Last updated: ${new Date(modified).toLocaleString()}`}>
          <TimestampIcon kind="updated" label={`Last updated: ${new Date(modified).toLocaleString()}`} />
          <span className={styles.trackItemTimestamp}>{formatTimestamp(modified)}</span>
        </div>
      ) : null}
    </div>
  );
}

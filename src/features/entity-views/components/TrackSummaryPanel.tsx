import React from "react";
import { Star } from "lucide-react";
import styles from "./TrackSummaryPanel.module.css";

export interface TrackSummaryStat {
  kind: "rating" | "energy";
  label: string;
  value: string;
  source: string;
  title?: string;
}

interface TrackSummaryPanelProps {
  /** Accessible name for the whole panel. */
  label: string;
  title: string;
  summary?: React.ReactNode;
  action?: React.ReactNode;
  /** A progress bar, shown full width under the heading. */
  progress?: React.ReactNode;
  stats?: TrackSummaryStat[];
  /** Status and guidance lines, such as loading or retry messages. */
  notices?: React.ReactNode;
  children?: React.ReactNode;
}

/** What the user's tracks say about an album, playlist, or artist, in one consistent panel. */
export function TrackSummaryPanel({
  label,
  title,
  summary,
  action,
  progress,
  stats = [],
  notices,
  children,
}: TrackSummaryPanelProps) {
  return (
    <section className={styles.panel} aria-label={label}>
      <div className={styles.header}>
        <h3 className={styles.title}>{title}</h3>
        {summary ? <span className={styles.summary}>{summary}</span> : null}
        {action ? <span className={styles.action}>{action}</span> : null}
      </div>

      {progress}

      {stats.length > 0 ? (
        <dl className={styles.stats}>
          {stats.map((stat) => (
            <div key={stat.kind} className={styles.stat} title={stat.title}>
              <dt>{stat.label}</dt>
              <dd>
                {stat.kind === "rating" ? (
                  <Star className={styles.starIcon} size={13} fill="currentColor" aria-hidden="true" />
                ) : null}
                <span
                  className={`${styles.statValue} ${stat.kind === "energy" ? styles.energyValue : ""}`}
                >
                  {stat.value}
                </span>
                <span className={styles.statSource}>{stat.source}</span>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {notices ? <div className={styles.notices}>{notices}</div> : null}

      {children}
    </section>
  );
}

interface TrackSummaryActionProps {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}

/** A quiet text action for the panel heading or its notices, such as Refresh or Try again. */
export function TrackSummaryAction({ onClick, disabled, children }: TrackSummaryActionProps) {
  return (
    <button type="button" className={styles.textButton} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

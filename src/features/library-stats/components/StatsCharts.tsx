import React from "react";
import styles from "./StatsCharts.module.css";

export const formatCount = (value: number) => value.toLocaleString("en-US");
/** "1 track", "12 tracks"; `kind` adds a word in between ("12 tagged tracks"). */
export const formatTracks = (value: number, kind = "") => `${formatCount(value)} ${kind ? `${kind} ` : ""}${value === 1 ? "track" : "tracks"}`;
export const formatPercent = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "0%");

/** A label, a number and an optional explanation. */
export function StatTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className={styles.tile}>
      <span className={styles.tileLabel}>{label}</span>
      <strong className={styles.tileValue}>{value}</strong>
      {detail && <span className={styles.tileDetail}>{detail}</span>}
    </div>
  );
}

/** A colored dot beside a tag name; the dot carries the tag's identity, the text stays in text color. */
export function TagName({ name, color, large = false }: { name: string; color: string | null; large?: boolean }) {
  return (
    <span className={`${styles.tagName} ${large ? styles.tagNameLarge : ""}`}>
      <span className={styles.tagDot} style={color ? { background: color } : undefined} aria-hidden="true" />
      {name}
    </span>
  );
}

export interface BarListItem {
  key: string;
  label: React.ReactNode;
  /** Plain text for tooltips and screen readers. */
  text: string;
  value: number;
  valueLabel?: string;
  onSelect?: () => void;
}

/** Horizontal bars in one hue, value at the tip. Rows become buttons when they can be opened. */
export function BarList({ items, emptyText, label, max: scaleMax }: {
  items: BarListItem[]; emptyText: string; label: string;
  /** Fixed end of the scale, such as 5 for star ratings; otherwise the largest value. */
  max?: number;
}) {
  if (!items.length) return <p className={styles.empty}>{emptyText}</p>;
  const max = scaleMax ?? Math.max(...items.map((item) => item.value), 1);
  return (
    <ol className={styles.barList} aria-label={label}>
      {items.map((item) => {
        const content = (
          <>
            <span className={styles.barLabel}>{item.label}</span>
            <span className={styles.barTrack} aria-hidden="true">
              <span className={styles.barFill} style={{ width: `${Math.max((item.value / max) * 100, 2)}%` }} />
            </span>
            <span className={styles.barValue}>{item.valueLabel ?? formatCount(item.value)}</span>
          </>
        );
        return (
          <li key={item.key} title={`${item.text}: ${item.valueLabel ?? formatCount(item.value)}`}>
            {item.onSelect
              ? <button type="button" className={styles.barRow} onClick={item.onSelect}>{content}</button>
              : <div className={styles.barRow}>{content}</div>}
          </li>
        );
      })}
    </ol>
  );
}

/** Vertical columns in one hue for an ordered scale such as months or ratings. */
export function ColumnChart({ items, label, emphasizeLast = false, onSelect }: {
  items: Array<{ key: string; label: string; value: number; title?: string }>;
  label: string;
  emphasizeLast?: boolean;
  /** Opens the tracks behind a column; columns become buttons when given. */
  onSelect?: (key: string) => void;
}) {
  const max = Math.max(...items.map((item) => item.value), 1);
  const total = items.reduce((sum, item) => sum + item.value, 0);
  return (
    <figure className={styles.columns} aria-label={label}>
      <ol className={styles.columnPlot}>
        {items.map((item, index) => {
          const description = `${item.title ?? item.label}: ${formatCount(item.value)}`;
          const content = (
            <>
              <span className={styles.columnValue}>{item.value > 0 ? formatCount(item.value) : ""}</span>
              <span className={`${styles.columnBar} ${emphasizeLast && index === items.length - 1 ? styles.columnBarCurrent : ""}`}
                style={{ height: `${item.value > 0 ? Math.max((item.value / max) * 100, 3) : 0}%` }} aria-hidden="true" />
              <span className={styles.columnLabel} aria-hidden="true">{item.label}</span>
            </>
          );
          return onSelect && item.value > 0 ? (
            <li key={item.key} className={styles.column}>
              <button type="button" className={styles.columnButton} onClick={() => onSelect(item.key)}
                title={`${description}. Show these tracks`} aria-label={`${description}. Show these tracks`}>{content}</button>
            </li>
          ) : (
            <li key={item.key} className={styles.column} title={description} aria-label={description}>{content}</li>
          );
        })}
      </ol>
      {total === 0 && <figcaption className={styles.empty}>Nothing in this period yet.</figcaption>}
    </figure>
  );
}

const HEAT_LEVELS = [styles.heat0, styles.heat1, styles.heat2, styles.heat3, styles.heat4];

/** One cell per day for the last 53 weeks, darker for more tracks first tagged that day. */
export function ActivityHeatmap({ days, onSelectDay }: { days: Array<{ date: string; count: number }>; onSelectDay?: (date: string) => void }) {
  const max = Math.max(...days.map((day) => day.count), 0);
  const level = (count: number) => (count === 0 || max === 0 ? 0 : Math.min(4, Math.ceil((count / max) * 4)));
  const total = days.reduce((sum, day) => sum + day.count, 0);
  const active = days.filter((day) => day.count > 0).length;
  const monthStarts = days.flatMap((day, index) => day.date.endsWith("-01") || index === 0
    ? [{ column: Math.floor(index / 7), label: new Date(`${day.date}T12:00`).toLocaleString("en-US", { month: "short" }) }] : []);
  // Labels need three columns of room; the first, partial month gives way to the next month.
  const monthLabels = monthStarts.reduce<typeof monthStarts>((shown, month, index) => {
    const previous = shown.at(-1);
    if (index === 0) return monthStarts[1] && monthStarts[1].column - month.column < 3 ? shown : [month];
    return !previous || month.column - previous.column >= 3 ? [...shown, month] : shown;
  }, []);
  return (
    <figure className={styles.heatmap}>
      <div className={styles.heatmapMonths} aria-hidden="true">
        {monthLabels.map((month) => <span key={`${month.column}-${month.label}`} style={{ gridColumn: month.column + 1 }}>{month.label}</span>)}
      </div>
      <div className={styles.heatmapGrid} role="img"
        aria-label={`${formatCount(total)} tracks first tagged over the last year, on ${formatCount(active)} different days`}>
        {/* Days open with a click; keyboard users reach the same tracks from the month chart below. */}
        {days.map((day) => (
          <span key={day.date} className={`${styles.heatCell} ${HEAT_LEVELS[level(day.count)]} ${onSelectDay && day.count > 0 ? styles.heatCellActive : ""}`}
            onClick={onSelectDay && day.count > 0 ? () => onSelectDay(day.date) : undefined}
            title={`${new Date(`${day.date}T12:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}: ${formatTracks(day.count)}`} />
        ))}
      </div>
      <figcaption className={styles.heatmapLegend} aria-hidden="true">
        Less {HEAT_LEVELS.map((className, index) => <span key={index} className={`${styles.heatCell} ${className}`} />)} More
      </figcaption>
    </figure>
  );
}

/** Camelot wheel: major keys (B) on the outer ring, minor keys (A) inside; darker means more tracks. */
export function CamelotWheel({ keys, onSelectKey }: { keys: Array<{ key: string; count: number }>; onSelectKey?: (key: string) => void }) {
  const max = Math.max(...keys.map((entry) => entry.count), 0);
  const counts = new Map(keys.map((entry) => [entry.key, entry.count]));
  const center = 110;
  const segment = (number: number, inner: number, outer: number) => {
    const angle = (index: number) => ((index - 0.5) / 12) * Math.PI * 2 - Math.PI / 2;
    const [start, end] = [angle(number - 1), angle(number)];
    const point = (radius: number, theta: number) => `${center + radius * Math.cos(theta)} ${center + radius * Math.sin(theta)}`;
    return `M ${point(outer, start)} A ${outer} ${outer} 0 0 1 ${point(outer, end)} L ${point(inner, end)} A ${inner} ${inner} 0 0 0 ${point(inner, start)} Z`;
  };
  const labelPoint = (number: number, radius: number) => {
    const theta = ((number - 1) / 12) * Math.PI * 2 - Math.PI / 2;
    return { x: center + radius * Math.cos(theta), y: center + radius * Math.sin(theta) };
  };
  const fill = (key: string) => {
    const count = counts.get(key) ?? 0;
    return count === 0 || max === 0 ? undefined : { opacity: 0.25 + 0.75 * (count / max) };
  };
  const busiest = [...keys].sort((left, right) => right.count - left.count).filter((entry) => entry.count > 0).slice(0, 3);
  return (
    <figure className={styles.wheel}>
      <svg viewBox="0 0 220 220" role="img" aria-label={busiest.length
        ? `Most common keys: ${busiest.map((entry) => `${entry.key} (${entry.count})`).join(", ")}`
        : "No keys yet"}>
        {Array.from({ length: 12 }, (_, index) => index + 1).flatMap((number) => [
          { key: `${number}B`, inner: 72, outer: 106 },
          { key: `${number}A`, inner: 38, outer: 70 },
        ].map(({ key, inner, outer }) => (
          <g key={key} className={onSelectKey && (counts.get(key) ?? 0) > 0 ? styles.wheelSegmentActive : undefined}
            onClick={onSelectKey && (counts.get(key) ?? 0) > 0 ? () => onSelectKey(key) : undefined}>
            <title>{`${key}: ${counts.get(key) ?? 0} ${(counts.get(key) ?? 0) === 1 ? "track" : "tracks"}`}</title>
            <path d={segment(number, inner, outer)} className={styles.wheelEmpty} />
            {fill(key) && <path d={segment(number, inner, outer)} className={styles.wheelFill} style={fill(key)} />}
          </g>
        )))}
        {Array.from({ length: 12 }, (_, index) => index + 1).flatMap((number) => [
          { key: `${number}B`, ...labelPoint(number, 89) },
          { key: `${number}A`, ...labelPoint(number, 54) },
        ]).map((label) => <text key={label.key} x={label.x} y={label.y} className={styles.wheelLabel} textAnchor="middle" dominantBaseline="central">{label.key}</text>)}
      </svg>
      {onSelectKey && busiest.length > 0 && (
        <figcaption className={styles.wheelKeys}>
          {busiest.map((entry) => (
            <button key={entry.key} type="button" onClick={() => onSelectKey(entry.key)} aria-label={`Show the ${formatTracks(entry.count)} in ${entry.key}`}>
              {entry.key} <span>{formatCount(entry.count)}</span>
            </button>
          ))}
        </figcaption>
      )}
    </figure>
  );
}

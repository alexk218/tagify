import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ListMusic, Play, X } from "lucide-react";
import type { TagDataStructure } from "@/types/tagData";
import { computeLibraryStats, computeTagDetail, selectStatsTracks, STATS_RANGE_LABELS, type LibraryStats, type StatsBaseline, type StatsRange, type StatsSelection, type StatsTag } from "../model/libraryStats";
import { ActivityHeatmap, BarList, CamelotWheel, ColumnChart, formatCount, formatPercent, formatTracks, StatTile, TagName } from "./StatsCharts";
import styles from "./StatsWorkspace.module.css";

type StatsTab = "overview" | "activity" | "tags" | "ratings" | "music";
const TABS: Array<{ id: StatsTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "activity", label: "Activity" },
  { id: "tags", label: "Tags" },
  { id: "ratings", label: "Ratings" },
  { id: "music", label: "Music" },
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Tracks Stats hands to the track list, with a label saying where they came from. */
export interface StatsTrackSet {
  label: string;
  trackUris: string[];
}

export interface StatsWorkspaceProps {
  tagData: TagDataStructure;
  /** Dates saved when Stats first opened; see `StatsBaseline`. */
  baseline?: StatsBaseline | null;
  /** Narrows the track list to exactly these tracks. */
  onShowTracks: (set: StatsTrackSet) => void;
  /** Opens one track for tagging, inside the list it was picked from. */
  onOpenTrack: (trackUri: string, set: StatsTrackSet) => void;
  onPlayTracks: (trackUris: string[]) => void;
  onClose: () => void;
}

/** What every section can do with the tracks behind a number. */
interface StatsActions {
  show: (selection: StatsSelection, label: string) => void;
  play: (selection: StatsSelection) => void;
  count: (selection: StatsSelection) => number;
  playTrack: (trackUri: string) => void;
  openTrack: (trackUri: string, selection: StatsSelection, label: string) => void;
}

const stars = (rating: number) => `${rating % 1 ? rating.toFixed(1) : rating}★`;
/** Averages always show one decimal so neighbouring values line up ("3.0★", "2.6★"). */
const averageStars = (rating: number) => `${rating.toFixed(1)}★`;
const monthLabel = (month: string, short = true) =>
  new Date(`${month}-01T12:00`).toLocaleString("en-US", short ? { month: "short" } : { month: "long", year: "numeric" });
/** Short month names, with the year on January and on the first column so long ranges stay readable. */
const monthAxisLabel = (month: string, index: number) =>
  index === 0 || month.endsWith("-01") ? `${monthLabel(month)} ’${month.slice(2, 4)}` : monthLabel(month);
const hourLabel = (hour: number) => `${hour % 12 || 12}${hour < 12 ? "am" : "pm"}`;
const dateLabel = (date: string) => new Date(`${date}T12:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function StatsWorkspace({ tagData, baseline = null, onShowTracks, onOpenTrack, onPlayTracks, onClose }: StatsWorkspaceProps) {
  const [now] = useState(() => Date.now());
  const [range, setRange] = useState<StatsRange>("all");
  const [tab, setTab] = useState<StatsTab>("overview");
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const stats = useMemo(() => computeLibraryStats(tagData, range, now, baseline), [tagData, range, now, baseline]);
  const detail = useMemo(() => selectedTagId ? computeTagDetail(tagData, stats, selectedTagId, now, baseline) : null, [tagData, stats, selectedTagId, now, baseline]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const tracksFor = (selection: StatsSelection) => selectStatsTracks(tagData, range, now, selection, baseline);
  // Labels name the period too, so the track list says exactly what it is showing.
  const scoped = (label: string, selection: StatsSelection) =>
    range === "all" || selection.kind === "day" || selection.kind === "month" ? label : `${label} · ${STATS_RANGE_LABELS[range]}`;
  const actions: StatsActions = {
    show: (selection, label) => onShowTracks({ label: scoped(label, selection), trackUris: tracksFor(selection) }),
    play: (selection) => onPlayTracks(tracksFor(selection)),
    count: (selection) => tracksFor(selection).length,
    playTrack: (trackUri) => onPlayTracks([trackUri]),
    openTrack: (trackUri, selection, label) => onOpenTrack(trackUri, { label: scoped(label, selection), trackUris: tracksFor(selection) }),
  };
  const openSection = (next: StatsTab, target?: string) => { setSelectedTagId(null); setTab(next); setAnchor(target ?? null); };
  // Jump to a section (such as "Never used") once its tab has rendered.
  useEffect(() => {
    if (!anchor) return;
    document.getElementById(anchor)?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    setAnchor(null);
  }, [anchor, tab]);
  const workspace = useRef<HTMLElement>(null);
  const firstRender = useRef(true);
  // Where the member was before opening a tag, so going back lands on the same row.
  const scrollBeforeTag = useRef(0);
  const openTag = (tag: StatsTag) => {
    if (!selectedTagId) scrollBeforeTag.current = workspace.current?.scrollTop ?? 0;
    setSelectedTagId(tag.id);
  };
  // A tag opens at its top; going back returns to where the member left off.
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    if (workspace.current) workspace.current.scrollTop = selectedTagId ? 0 : scrollBeforeTag.current;
  }, [selectedTagId]);

  return (
    <section ref={workspace} className={styles.workspace} aria-labelledby="tagify-stats-title">
      <header className={styles.header}>
        <div>
          <h2 id="tagify-stats-title" className={styles.title}>Stats</h2>
          <p className={styles.subtitle}>
            {range === "all" ? "Everything you've tagged in Tagify." : `Tracks you first tagged in the ${STATS_RANGE_LABELS[range].toLowerCase()}.`}
          </p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.segmented} role="radiogroup" aria-label="Time range">
            {(Object.keys(STATS_RANGE_LABELS) as StatsRange[]).map((option) => (
              <button key={option} type="button" role="radio" aria-checked={range === option}
                className={range === option ? styles.segmentActive : ""} onClick={() => setRange(option)}>
                {STATS_RANGE_LABELS[option]}
              </button>
            ))}
          </div>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close stats"><X size={16} /></button>
        </div>
      </header>

      {stats.undatedTracks > 0 && (range !== "all" || (tab === "activity" && !detail)) && (
        <p className={styles.note}>
          {formatCount(stats.undatedTracks)} {stats.undatedTracks === 1 ? "track was" : "tracks were"} tagged before Tagify kept dates, so {range !== "all"
            ? `${stats.undatedTracks === 1 ? "it only counts" : "they only count"} under All time.`
            : `${stats.undatedTracks === 1 ? "it isn't" : "they aren't"} in these charts.`}
        </p>
      )}

      {detail ? (
        <TagDetailView detail={detail} backLabel={TABS.find((item) => item.id === tab)!.label} onBack={() => setSelectedTagId(null)} onSelectTag={openTag} actions={actions} />
      ) : (
        <>
          <nav className={styles.tabs} role="tablist" aria-label="Stats sections">
            {TABS.map((item) => (
              <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} id={`stats-tab-${item.id}`}
                aria-controls="stats-panel" className={tab === item.id ? styles.tabActive : ""} onClick={() => setTab(item.id)}>
                {item.label}
              </button>
            ))}
          </nav>
          <div className={styles.panel} role="tabpanel" id="stats-panel" aria-labelledby={`stats-tab-${tab}`}>
            {stats.overview.tracks === 0 && stats.overview.albums === 0 && stats.overview.artists === 0 && stats.overview.playlists === 0
              ? <p className={styles.emptyState}>{range === "all" ? "Tag a few tracks and your stats will show up here." : "You didn't tag anything new in this period."}</p>
              : tab === "overview" ? <OverviewTab stats={stats} onOpenSection={openSection} onSelectTag={openTag} actions={actions} />
              : tab === "activity" ? <ActivityTab stats={stats} actions={actions} />
              : tab === "tags" ? <TagsTab stats={stats} onSelectTag={openTag} actions={actions} />
              : tab === "ratings" ? <RatingsTab stats={stats} onSelectTag={openTag} actions={actions} />
              : <MusicTab stats={stats} actions={actions} />}
          </div>
        </>
      )}
    </section>
  );
}

function Section({ title, description, children, wide = false, id }: { title: string; description?: string; children: React.ReactNode; wide?: boolean; id?: string }) {
  return (
    <section id={id} className={`${styles.card} ${wide ? styles.cardWide : ""}`}>
      <h3 className={styles.cardTitle}>{title}</h3>
      {description && <p className={styles.cardDescription}>{description}</p>}
      {children}
    </section>
  );
}

function Attention({ count, text, onShow, onPlay }: { count: number; text: string; onShow: () => void; onPlay?: () => void }) {
  if (count === 0) return null;
  const name = `${formatCount(count)} ${text}`;
  return (
    <li className={styles.attention}>
      <span><strong>{formatCount(count)}</strong> {text}</span>
      <span className={styles.attentionActions}>
        <button type="button" className={styles.actionButton} onClick={onShow} aria-label={`Show tracks: ${name}`}><ListMusic size={13} /> Show tracks</button>
        {onPlay && <button type="button" className={styles.actionButton} onClick={onPlay} aria-label={`Play: ${name}`}><Play size={13} /> Play</button>}
      </span>
    </li>
  );
}

function OverviewTab({ stats, onOpenSection, onSelectTag, actions }: {
  stats: LibraryStats; onOpenSection: (tab: StatsTab, anchor?: string) => void; onSelectTag: (tag: StatsTag) => void; actions: StatsActions;
}) {
  const { overview, activity, ratings, tags } = stats;
  const coverage = [
    { key: "tagged", text: "Tagged", value: overview.taggedTracks },
    { key: "rated", text: "Rated", value: overview.ratedTracks },
    { key: "energy", text: "Energy set", value: overview.energyTracks },
    { key: "complete", text: "Tags, rating and energy", value: overview.completeTracks },
  ];
  const needsAttention = ratings.taggedUnrated.length + ratings.ratedUntagged.length + ratings.missingEnergy.length + tags.unused.length;
  return (
    <div className={styles.grid}>
      <section className={`${styles.card} ${styles.cardWide} ${styles.hero}`}>
        <span className={styles.heroValue}>{formatCount(overview.taggedTracks)}</span>
        <span className={styles.heroLabel}>{overview.taggedTracks === 1 ? "track tagged" : "tracks tagged"}</span>
        <div className={styles.tiles}>
          <StatTile label="Albums tagged" value={formatCount(overview.albums)} />
          <StatTile label="Artists tagged" value={formatCount(overview.artists)} />
          <StatTile label="Playlists tagged" value={formatCount(overview.playlists)} />
          <StatTile label="Tags used" value={`${formatCount(overview.tagsUsed)} of ${formatCount(overview.tagsTotal)}`} detail={`${formatCount(overview.tagsColored)} with colors`} />
          <StatTile label="Tags per track" value={overview.averageTagsPerTaggedTrack.toFixed(1)} detail="on tagged tracks" />
          <StatTile label="Average rating" value={overview.averageRating === null ? "–" : averageStars(overview.averageRating)} />
          <StatTile label="Tagging streak" value={`${activity.currentStreak} ${activity.currentStreak === 1 ? "day" : "days"}`} detail={`Best: ${activity.longestStreak}`} />
        </div>
      </section>
      <Section title="How complete your tracks are" description={`Based on ${formatCount(overview.tracks)} ${overview.tracks === 1 ? 'track' : 'tracks'} with saved details.`}>
        <BarList label="Track completeness" emptyText="No tracks yet."
          items={coverage.map((item) => ({ key: item.key, label: item.text, text: item.text, value: item.value, valueLabel: `${formatCount(item.value)} · ${formatPercent(item.value, overview.tracks)}` }))} />
      </Section>
      <Section title="Top tags">
        <BarList label="Top tags" emptyText="No tags used yet."
          items={tags.top.slice(0, 6).map((tag) => ({ key: tag.id, label: <TagName name={tag.name} color={tag.color} />, text: tag.name, value: tag.total, onSelect: () => onSelectTag(tag) }))} />
        <button type="button" className={styles.linkButton} onClick={() => onOpenSection("tags")}>All tag stats</button>
      </Section>
      <Section title="Worth a look" description={needsAttention ? "Quick ways to round out your library." : "Nothing missing. Nice."} wide>
        <ul className={styles.attentionList}>
          <AttentionRows stats={stats} actions={actions} withEnergy />
          {tags.unused.length > 0 && (
            <li className={styles.attention}>
              <span><strong>{formatCount(tags.unused.length)}</strong> {tags.unused.length === 1 ? "tag you haven't used yet" : "tags you haven't used yet"}</span>
              <button type="button" className={styles.actionButton} onClick={() => onOpenSection("tags", "stats-never-used")}>See them</button>
            </li>
          )}
        </ul>
      </Section>
    </div>
  );
}

function AttentionRows({ stats, actions, withEnergy = false }: { stats: LibraryStats; actions: StatsActions; withEnergy?: boolean }) {
  const { ratings } = stats;
  // The track list shows its own count, so these labels name the set without repeating a number.
  return (
    <>
      <Attention count={ratings.taggedUnrated.length} text={ratings.taggedUnrated.length === 1 ? "tagged track has no rating" : "tagged tracks have no rating"}
        onShow={() => actions.show({ kind: "taggedUnrated" }, "Tagged tracks with no rating")} onPlay={() => actions.play({ kind: "taggedUnrated" })} />
      <Attention count={ratings.ratedUntagged.length} text={ratings.ratedUntagged.length === 1 ? "rated track has no tags" : "rated tracks have no tags"}
        onShow={() => actions.show({ kind: "ratedUntagged" }, "Rated tracks with no tags")} onPlay={() => actions.play({ kind: "ratedUntagged" })} />
      {withEnergy && <Attention count={ratings.missingEnergy.length} text={ratings.missingEnergy.length === 1 ? "tagged track has no energy" : "tagged tracks have no energy"}
        onShow={() => actions.show({ kind: "missingEnergy" }, "Tagged tracks with no energy")} onPlay={() => actions.play({ kind: "missingEnergy" })} />}
    </>
  );
}

function ActivityTab({ stats, actions }: { stats: LibraryStats; actions: StatsActions }) {
  const { activity } = stats;
  return (
    <div className={styles.grid}>
      <Section title="Your tagging year" description="Tracks first tagged each day over the last 53 weeks." wide>
        <ActivityHeatmap days={activity.days} onSelectDay={(date) => actions.show({ kind: "day", date }, `First tagged on ${dateLabel(date)}`)} />
      </Section>
      <section className={`${styles.card} ${styles.cardWide}`}>
        <div className={styles.tiles}>
          <StatTile label="Current streak" value={`${activity.currentStreak} ${activity.currentStreak === 1 ? "day" : "days"}`} />
          <StatTile label="Longest streak" value={`${activity.longestStreak} ${activity.longestStreak === 1 ? "day" : "days"}`} />
          <StatTile label="Days you tagged" value={formatCount(activity.activeDays)} />
          <StatTile label="Busiest day" value={activity.busiestDay ? formatCount(activity.busiestDay.count) : "–"} detail={activity.busiestDay ? dateLabel(activity.busiestDay.date) : undefined} />
        </div>
      </section>
      <Section title="By month" description="Tracks first tagged each month." wide>
        <ColumnChart label="Tracks first tagged by month" emphasizeLast
          onSelect={(month) => actions.show({ kind: "month", month }, `First tagged in ${monthLabel(month, false)}`)}
          items={activity.months.map((month, index) => ({ key: month.month, label: monthAxisLabel(month.month, index), title: monthLabel(month.month, false), value: month.count }))} />
      </Section>
      <Section title="By time of day" description="When you first tag tracks, in your local time.">
        <ColumnChart label="Tracks first tagged by hour of the day"
          items={activity.hours.map((count, hour) => ({ key: String(hour), label: hour % 6 === 0 ? hourLabel(hour) : "", title: `${hourLabel(hour)}–${hourLabel((hour + 1) % 24)}`, value: count }))} />
      </Section>
      <Section title="By day of the week">
        <BarList label="Tracks first tagged by day of the week" emptyText="No dated tagging yet."
          items={activity.weekdays.some(Boolean) ? activity.weekdays.map((count, index) => ({ key: WEEKDAYS[index], label: WEEKDAYS[index], text: WEEKDAYS[index], value: count })) : []} />
      </Section>
    </div>
  );
}

function TagsTab({ stats, onSelectTag, actions }: { stats: LibraryStats; onSelectTag: (tag: StatsTag) => void; actions: StatsActions }) {
  const [query, setQuery] = useState("");
  const { tags } = stats;
  const matching = tags.all.filter((tag) => !query.trim() || tag.path.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className={styles.grid}>
      <Section title="Most used">
        <BarList label="Most used tags" emptyText="No tags used yet."
          items={tags.top.map((tag) => ({ key: tag.id, label: <TagName name={tag.name} color={tag.color} />, text: tag.name, value: tag.total, onSelect: () => onSelectTag(tag) }))} />
      </Section>
      <Section title="On the rise" description="Used on more tracks in the last 30 days than in the 30 before.">
        <BarList label="Rising tags" emptyText="No tag picked up speed this month."
          items={tags.rising.map((tag) => ({ key: tag.id, label: <TagName name={tag.name} color={tag.color} />, text: `${tag.name}, ${formatCount(tag.recentTracks)} tracks this month`, value: tag.recentTracks - tag.previousTracks, valueLabel: `+${formatCount(tag.recentTracks - tag.previousTracks)}`, onSelect: () => onSelectTag(tag) }))} />
      </Section>
      <Section title="Tags that go together" description="Pairs that share the most tracks." wide>
        {tags.pairs.length ? (
          <ol className={styles.pairList}>
            {tags.pairs.map((pair) => (
              <li key={`${pair.a.id}-${pair.b.id}`}>
                <button type="button" className={styles.chipButton} onClick={() => onSelectTag(pair.a)}><TagName name={pair.a.name} color={pair.a.color} /></button>
                <span aria-hidden="true">+</span>
                <button type="button" className={styles.chipButton} onClick={() => onSelectTag(pair.b)}><TagName name={pair.b.name} color={pair.b.color} /></button>
                <button type="button" className={styles.pairCount} onClick={() => actions.show({ kind: "pair", tagIds: [pair.a.id, pair.b.id] }, `Tagged ${pair.a.name} and ${pair.b.name}`)}
                  aria-label={`Show the ${formatTracks(pair.tracks)} tagged ${pair.a.name} and ${pair.b.name}`}>
                  {formatCount(pair.tracks)} {pair.tracks === 1 ? "track" : "tracks"}
                </button>
              </li>
            ))}
          </ol>
        ) : <p className={styles.empty}>Give some tracks more than one tag to see which tags you combine.</p>}
      </Section>
      <Section title="By category" description="How often you use each category's tags.">
        <BarList label="Tag uses by category" emptyText="No categories yet."
          items={tags.categories.map((category) => ({ key: category.id, label: category.name, text: category.name, value: category.uses, valueLabel: `${formatCount(category.uses)} · ${category.usedTags}/${category.tags} tags`,
            onSelect: category.uses > 0 ? () => actions.show({ kind: "category", categoryId: category.id }, `Tagged with ${category.name} tags`) : undefined }))} />
      </Section>
      <Section title="Left behind" description="Not on any track you've changed in the last 90 days.">
        {tags.stale.length ? <ul className={styles.chipList}>{tags.stale.map((tag) => (
          <li key={tag.id}><button type="button" className={styles.chipButton} onClick={() => onSelectTag(tag)} title={tag.path}><TagName name={tag.name} color={tag.color} /></button></li>
        ))}</ul> : <p className={styles.empty}>You've used all your tags recently.</p>}
      </Section>
      <Section id="stats-never-used" title="Never used" description={tags.unused.length ? `${formatCount(tags.unused.length)} of ${formatCount(stats.overview.tagsTotal)} tags.` : undefined} wide>
        {tags.unused.length ? <ul className={styles.chipList}>{tags.unused.map((tag) => (
          <li key={tag.id} className={styles.chip} title={tag.path}><TagName name={tag.name} color={tag.color} /></li>
        ))}</ul> : <p className={styles.empty}>Every tag is in use.</p>}
      </Section>
      <Section title="Every tag" wide>
        <input className={styles.search} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a tag" aria-label="Find a tag" />
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th scope="col">Tag</th><th scope="col">Tracks</th><th scope="col">Albums</th><th scope="col">Artists</th><th scope="col">Playlists</th><th scope="col">Total</th></tr></thead>
            <tbody>
              {matching.map((tag) => (
                <tr key={tag.id}>
                  <th scope="row"><button type="button" className={styles.tableTag} onClick={() => onSelectTag(tag)} title={tag.path}><TagName name={tag.name} color={tag.color} /><small>{tag.path}</small></button></th>
                  <td>{formatCount(tag.tracks)}</td><td>{formatCount(tag.albums)}</td><td>{formatCount(tag.artists)}</td><td>{formatCount(tag.playlists)}</td><td>{formatCount(tag.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!matching.length && <p className={styles.empty}>No tags match that search.</p>}
        </div>
      </Section>
    </div>
  );
}

function RatingsTab({ stats, onSelectTag, actions }: { stats: LibraryStats; onSelectTag: (tag: StatsTag) => void; actions: StatsActions }) {
  const { ratings, overview } = stats;
  return (
    <div className={styles.grid}>
      <Section title="How you rate" description={overview.averageRating === null ? "No ratings yet." : `${formatCount(overview.ratedTracks)} rated tracks, ${averageStars(overview.averageRating)} on average.`} wide>
        <ColumnChart label="Tracks by rating" onSelect={(rating) => actions.show({ kind: "rating", rating: Number(rating) }, `Rated ${stars(Number(rating))}`)}
          items={ratings.distribution.map((entry) => ({ key: String(entry.rating), label: stars(entry.rating), title: `Rated ${stars(entry.rating)}`, value: entry.count }))} />
      </Section>
      <Section title="Best-rated tags" description="Average rating of tracks with each tag (at least 3 rated tracks).">
        <BarList label="Best-rated tags" max={5} emptyText="Rate a few more tagged tracks to compare your tags."
          items={ratings.tagAverages.slice(0, 10).map((entry) => ({ key: entry.tag.id, label: <TagName name={entry.tag.name} color={entry.tag.color} />, text: entry.tag.name, value: entry.average, valueLabel: `${averageStars(entry.average)} · ${formatCount(entry.tracks)}`, onSelect: () => onSelectTag(entry.tag) }))} />
      </Section>
      <Section title="Lowest-rated tags">
        <BarList label="Lowest-rated tags" max={5} emptyText="Rate a few more tagged tracks to compare your tags."
          items={ratings.tagAverages.length > 10 ? [...ratings.tagAverages].reverse().slice(0, 5).map((entry) => ({ key: entry.tag.id, label: <TagName name={entry.tag.name} color={entry.tag.color} />, text: entry.tag.name, value: entry.average, valueLabel: `${averageStars(entry.average)} · ${formatCount(entry.tracks)}`, onSelect: () => onSelectTag(entry.tag) })) : []} />
      </Section>
      <Section title="Worth a look" wide>
        <ul className={styles.attentionList}>
          <AttentionRows stats={stats} actions={actions} />
        </ul>
        {!ratings.taggedUnrated.length && !ratings.ratedUntagged.length && <p className={styles.empty}>Every tagged track is rated, and every rated track is tagged.</p>}
      </Section>
    </div>
  );
}

function MusicTab({ stats, actions }: { stats: LibraryStats; actions: StatsActions }) {
  const { music, overview } = stats;
  return (
    <div className={styles.grid}>
      <Section title="Most-tagged artists">
        <BarList label="Most-tagged artists" emptyText="Artist names show up as Tagify saves track details."
          items={music.artists.map((artist) => ({ key: artist.name, label: artist.name, text: artist.name, value: artist.tracks, valueLabel: `${formatCount(artist.tracks)}${artist.averageRating === null ? "" : ` · ${averageStars(artist.averageRating)}`}`,
            onSelect: () => actions.show({ kind: "artist", name: artist.name }, `Tagged tracks by ${artist.name}`) }))} />
      </Section>
      <Section title="Most-tagged albums">
        {music.albums.length ? (
          <ol className={styles.albumList}>
            {music.albums.map((album) => (
              <li key={album.uri}>
                <button type="button" className={styles.listRow} onClick={() => actions.show({ kind: "album", uri: album.uri }, `Tagged tracks from ${album.name}`)}
                  aria-label={`Show the ${formatTracks(album.tracks, "tagged")} from ${album.name}`}>
                  <span className={styles.albumArt}>{album.imageUrl && <img src={album.imageUrl} alt="" loading="lazy" />}</span>
                  <span className={styles.albumText}><strong>{album.name}</strong><small>{album.artists}</small></span>
                  <span className={styles.listValue}>{formatCount(album.tracks)}</span>
                </button>
              </li>
            ))}
          </ol>
        ) : <p className={styles.empty}>Album details show up as Tagify saves track details.</p>}
      </Section>
      <Section title="Tempo" description={music.averageBpm === null ? "No BPM yet." : `${formatCount(overview.bpmTracks)} tracks, ${Math.round(music.averageBpm)} BPM on average.`} wide>
        <ColumnChart label="Tracks by BPM" onSelect={(label) => actions.show({ kind: "bpm", label }, `${label} BPM`)}
          items={music.bpm.map((bucket) => ({ key: bucket.label, label: bucket.label, title: `${bucket.label} BPM`, value: bucket.count }))} />
      </Section>
      <Section title="Energy" description={`${formatCount(overview.energyTracks)} tracks with an energy level.`}>
        <ColumnChart label="Tracks by energy" onSelect={(energy) => actions.show({ kind: "energy", energy: Number(energy) }, `Energy ${energy}`)}
          items={music.energy.map((entry) => ({ key: String(entry.energy), label: String(entry.energy), title: `Energy ${entry.energy}`, value: entry.count }))} />
      </Section>
      <Section title="Keys" description={`${formatCount(overview.keyTracks)} tracks with a key. Outer ring major, inner ring minor.`}>
        <CamelotWheel keys={music.keys} onSelectKey={(key) => actions.show({ kind: "key", key }, `Key ${key}`)} />
      </Section>
    </div>
  );
}

function TagDetailView({ detail, backLabel, onBack, onSelectTag, actions }: {
  detail: NonNullable<ReturnType<typeof computeTagDetail>>; backLabel: string; onBack: () => void; onSelectTag: (tag: StatsTag) => void; actions: StatsActions;
}) {
  const { tag } = detail;
  const selection: StatsSelection = { kind: "tag", tagId: tag.id };
  const label = `Tagged ${tag.name}`;
  return (
    <div className={styles.panel}>
      <div className={styles.detailHeader}>
        <button type="button" className={styles.backButton} onClick={onBack}><ArrowLeft size={14} /> {backLabel}</button>
        <h3 className={styles.detailTitle}><TagName name={tag.name} color={tag.color} large /></h3>
        <p className={styles.cardDescription}>{tag.path}</p>
        <div className={styles.detailActions}>
          <button type="button" className={styles.actionButton} onClick={() => actions.show(selection, label)} disabled={!detail.trackUris.length}><ListMusic size={13} /> Show tracks</button>
          <button type="button" className={styles.actionButton} onClick={() => actions.play(selection)} disabled={!detail.trackUris.length}><Play size={13} /> Play</button>
        </div>
      </div>
      <div className={styles.grid}>
        <section className={`${styles.card} ${styles.cardWide}`}>
          <div className={styles.tiles}>
            <StatTile label="Tracks" value={formatCount(tag.tracks)} />
            {tag.albums > 0 && <StatTile label="Albums" value={formatCount(tag.albums)} />}
            {tag.artists > 0 && <StatTile label="Artists" value={formatCount(tag.artists)} />}
            {tag.playlists > 0 && <StatTile label="Playlists" value={formatCount(tag.playlists)} />}
            <StatTile label="Average rating" value={detail.averageRating === null ? "–" : averageStars(detail.averageRating)} />
          </div>
        </section>
        <Section title="Over the last year" description="Tracks with this tag, by the month you first tagged them." wide>
          <ColumnChart label={`Tracks tagged ${tag.name} by month`} emphasizeLast
            onSelect={(month) => actions.show({ ...selection, month }, `${label}, first tagged in ${monthLabel(month, false)}`)}
            items={detail.months.map((month, index) => ({ key: month.month, label: monthAxisLabel(month.month, index), title: monthLabel(month.month, false), value: month.count }))} />
        </Section>
        <Section title="Often paired with" description="Share of this tag's tracks that also have each tag.">
          <BarList label={`Tags often paired with ${tag.name}`} emptyText="This tag hasn't shared a track with another tag yet."
            items={detail.companions.map((entry) => ({ key: entry.tag.id, label: <TagName name={entry.tag.name} color={entry.tag.color} />, text: entry.tag.name, value: entry.share, valueLabel: formatPercent(entry.tracks, tag.tracks), onSelect: () => onSelectTag(entry.tag) }))} />
        </Section>
        <Section title="Top artists">
          <BarList label={`Top artists tagged ${tag.name}`} emptyText="Artist names show up as Tagify saves track details."
            items={detail.artists.map((artist) => ({ key: artist.name, label: artist.name, text: artist.name, value: artist.tracks,
              onSelect: () => actions.show({ ...selection, artist: artist.name }, `${label}, by ${artist.name}`) }))} />
        </Section>
        <Section title="Ratings" wide>
          <ColumnChart label={`Ratings of tracks tagged ${tag.name}`}
            onSelect={(rating) => actions.show({ ...selection, rating: Number(rating) }, `${label}, rated ${stars(Number(rating))}`)}
            items={detail.ratings.map((entry) => ({ key: String(entry.rating), label: stars(entry.rating), title: `Rated ${stars(entry.rating)}`, value: entry.count }))} />
        </Section>
        <Section title="Recently tagged" wide>
          {detail.recent.length ? (
            <ol className={styles.albumList}>
              {detail.recent.map((item) => (
                <li key={item.uri}>
                  <button type="button" className={styles.listRow} onClick={() => actions.openTrack(item.uri, selection, label)} aria-label={`Open ${item.name} in Tagify`}>
                    <span className={styles.albumArt}>{item.imageUrl && <img src={item.imageUrl} alt="" loading="lazy" />}</span>
                    <span className={styles.albumText}><strong>{item.name}</strong><small>{item.artists || "Unknown artist"}</small></span>
                    <span className={styles.listValue}>{item.rating > 0 ? stars(item.rating) : "Not rated"}</span>
                  </button>
                  <button type="button" className={styles.iconButton} onClick={() => actions.playTrack(item.uri)} aria-label={`Play ${item.name}`}><Play size={13} /></button>
                </li>
              ))}
            </ol>
          ) : <p className={styles.empty}>No tracks have this tag in this period.</p>}
        </Section>
      </div>
    </div>
  );
}

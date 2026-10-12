import type { TagDataStructure, TrackData } from "@/types/tagData";
import { buildResolvedTagLookup, findTagAccentId } from "@/utils/tagTaxonomy";
import { getTagAccentTokens } from "@/features/tag-data/utils/tagAccent";

/** Which tracks the stats describe, by when they were first tagged. */
export type StatsRange = "all" | "12m" | "90d" | "30d";

export const STATS_RANGE_LABELS: Record<StatsRange, string> = {
  all: "All time",
  "12m": "Last 12 months",
  "90d": "Last 90 days",
  "30d": "Last 30 days",
};

const DAY_MS = 86_400_000;
const HEATMAP_WEEKS = 53;
const TOP_LIMIT = 12;
const PAIR_LIMIT = 15;
const MIN_TRACKS_FOR_TAG_AVERAGE = 3;
const STALE_TAG_DAYS = 90;
const GROWTH_WINDOW_DAYS = 30;

export const RATING_STEPS = Array.from({ length: 10 }, (_, index) => (index + 1) / 2);
export const ENERGY_STEPS = Array.from({ length: 10 }, (_, index) => index + 1);
export const BPM_BUCKETS = [
  { label: "<80", min: null, max: 80 },
  { label: "80–100", min: 80, max: 100 },
  { label: "100–120", min: 100, max: 120 },
  { label: "120–125", min: 120, max: 125 },
  { label: "125–128", min: 125, max: 128 },
  { label: "128–130", min: 128, max: 130 },
  { label: "130–135", min: 130, max: 135 },
  { label: "135–140", min: 135, max: 140 },
  { label: "140–150", min: 140, max: 150 },
  { label: "150–160", min: 150, max: 160 },
  { label: "160+", min: 160, max: null },
] as const;
export const CAMELOT_KEYS = Array.from({ length: 12 }, (_, index) => index + 1)
  .flatMap((number) => [`${number}A`, `${number}B`]);

export interface StatsTag {
  id: string;
  name: string;
  path: string;
  categoryId: string;
  categoryName: string;
  /** Hex color the user gave the tag, if any. */
  color: string | null;
  tracks: number;
  albums: number;
  playlists: number;
  artists: number;
  total: number;
  /** Tracks first tagged in the last 30 days that carry the tag, and in the 30 days before. */
  recentTracks: number;
  previousTracks: number;
  /** Latest change to any track carrying the tag. */
  lastUsedAt: number | null;
}

export interface StatsTrackRef {
  uri: string;
  name: string;
  artists: string;
  imageUrl: string | null;
  rating: number;
  dateCreated: number | null;
}

export interface LibraryStats {
  range: StatsRange;
  /** Tracks without a first-tagged date can't be placed in time; they only count under All time. */
  undatedTracks: number;
  overview: {
    tracks: number;
    taggedTracks: number;
    ratedTracks: number;
    energyTracks: number;
    bpmTracks: number;
    keyTracks: number;
    completeTracks: number;
    localTracks: number;
    albums: number;
    playlists: number;
    artists: number;
    tagsTotal: number;
    tagsUsed: number;
    tagsColored: number;
    categories: number;
    averageTagsPerTaggedTrack: number;
    averageRating: number | null;
  };
  activity: {
    /** Tracks first tagged per local day, oldest first, covering the last 53 weeks ending today. */
    days: Array<{ date: string; count: number }>;
    months: Array<{ month: string; count: number }>;
    weekdays: number[];
    /** Tracks first tagged in each local hour of the day, 0–23. */
    hours: number[];
    currentStreak: number;
    longestStreak: number;
    busiestDay: { date: string; count: number } | null;
    activeDays: number;
    lastTaggedAt: number | null;
  };
  tags: {
    all: StatsTag[];
    top: StatsTag[];
    rising: StatsTag[];
    unused: StatsTag[];
    stale: StatsTag[];
    categories: Array<{ id: string; name: string; uses: number; tags: number; usedTags: number }>;
    pairs: Array<{ a: StatsTag; b: StatsTag; tracks: number }>;
  };
  ratings: {
    distribution: Array<{ rating: number; count: number }>;
    tagAverages: Array<{ tag: StatsTag; average: number; tracks: number }>;
    taggedUnrated: string[];
    ratedUntagged: string[];
    missingEnergy: string[];
  };
  music: {
    artists: Array<{ name: string; tracks: number; averageRating: number | null }>;
    albums: Array<{ uri: string; name: string; artists: string; imageUrl: string | null; tracks: number }>;
    bpm: Array<{ label: string; count: number }>;
    averageBpm: number | null;
    energy: Array<{ energy: number; count: number }>;
    keys: Array<{ key: string; count: number }>;
  };
}

export interface TagDetail {
  tag: StatsTag;
  months: Array<{ month: string; count: number }>;
  ratings: Array<{ rating: number; count: number }>;
  averageRating: number | null;
  companions: Array<{ tag: StatsTag; tracks: number; share: number }>;
  artists: Array<{ name: string; tracks: number }>;
  recent: StatsTrackRef[];
  trackUris: string[];
}

export function dayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function monthKey(timestamp: number): string {
  return dayKey(timestamp).slice(0, 7);
}

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Midnight `days` calendar days from the day of `timestamp`, correct across daylight saving changes. */
function addDays(timestamp: number, days: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days).getTime();
}

export function rangeStart(range: StatsRange, now: number): number | null {
  if (range === "all") return null;
  // A year back to the day after today's date, like the tagging calendar.
  if (range === "12m") { const date = new Date(now); return new Date(date.getFullYear() - 1, date.getMonth(), date.getDate() + 1).getTime(); }
  return addDays(now, -((range === "90d" ? 90 : 30) - 1));
}

/**
 * Each track's last-updated date when Stats first opened, so a library already has a history on
 * day one. Tracks tagged after `takenAt` count from when they were first tagged. Saved once and
 * never updated, since last-updated moves with every edit.
 */
export interface StatsBaseline {
  takenAt: number;
  dates: Record<string, number>;
}

/** The baseline for a library: each annotated track's last-updated date (or first-tagged date). */
export function createStatsBaseline(tracks: TagDataStructure["tracks"], now: number): StatsBaseline {
  const dates: Record<string, number> = {};
  for (const [uri, track] of Object.entries(tracks)) {
    if (!isAnnotated(track)) continue;
    const date = track.dateModified ?? track.dateCreated;
    if (typeof date === "number") dates[uri] = date;
  }
  return { takenAt: now, dates };
}

/**
 * Libraries from before Tagify's first release (17 July 2025) got one date, to the millisecond,
 * for every track they already had when dates were introduced. A batch at least this large at a
 * library's earliest date, before the release, is that stamp rather than a tagging session.
 * Released versions have always dated tracks when they're first tagged, so later batches are
 * real bulk tagging.
 */
const MIN_DATE_STAMP_TRACKS = 20;
const FIRST_RELEASE = new Date(2025, 6, 17).getTime();

function dateStamp(entries: Array<[string, TrackData]>): number | null {
  let stamp = Infinity, stamped = 0;
  for (const [, track] of entries) {
    if (typeof track.dateCreated !== "number") continue;
    if (track.dateCreated < stamp) { stamp = track.dateCreated; stamped = 1; }
    else if (track.dateCreated === stamp) stamped += 1;
  }
  return stamped >= MIN_DATE_STAMP_TRACKS && stamp < FIRST_RELEASE ? stamp : null;
}

/**
 * Tracks with the date Stats counts them by, as `dateCreated`: the baseline date for tracks that
 * were already tagged when Stats first opened, otherwise when they were first tagged. A date that
 * is only the shared stamp from when dates were introduced counts as no date (All time only).
 * Stored dates are never changed.
 */
export function statsTrackEntries(tracks: TagDataStructure["tracks"], baseline: StatsBaseline | null = null): Array<[string, TrackData]> {
  const entries = Object.entries(tracks);
  const stamp = dateStamp(entries);
  if (!baseline && stamp === null) return entries;
  return entries.map(([uri, track]) => {
    const created = track.dateCreated;
    const taggedSinceBaseline = typeof created === "number" && baseline !== null && created > baseline.takenAt;
    const saved = baseline && !taggedSinceBaseline && uri in baseline.dates;
    let date = saved ? baseline.dates[uri] : created;
    // Without saved dates (they couldn't be read), a stamped track changed since counts from then.
    if (date === stamp) date = !saved && typeof track.dateModified === "number" && track.dateModified > stamp ? track.dateModified : undefined;
    return date === created ? [uri, track] : [uri, { ...track, dateCreated: date }];
  });
}

function isAnnotated(track: TrackData): boolean {
  return track.tagIds.length > 0 || track.rating > 0 || track.energy > 0;
}

function trackArtists(track: TrackData): string[] {
  return (track.artists ?? "").split(", ").map((name) => name.trim()).filter(Boolean);
}

/** Last `count` months ending with the month of `now`, oldest first. */
function recentMonths(now: number, count: number): string[] {
  const date = new Date(now);
  return Array.from({ length: count }, (_, index) =>
    monthKey(new Date(date.getFullYear(), date.getMonth() - (count - 1 - index), 1).getTime()));
}

function inRange(timestamp: number | undefined, start: number | null): boolean {
  return start === null || (typeof timestamp === "number" && timestamp >= start);
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function resolveTags(tagData: TagDataStructure): Map<string, StatsTag> {
  const lookup = buildResolvedTagLookup(tagData.taxonomy);
  const customAccents = tagData.taxonomy.customAccentsById ?? {};
  const tags = new Map<string, StatsTag>();
  for (const [id, node] of lookup) {
    tags.set(id, {
      id, name: node.name, path: node.displayPath, categoryId: node.category.id, categoryName: node.categoryName,
      color: getTagAccentTokens(findTagAccentId(tagData.taxonomy, id), customAccents)?.dot ?? null,
      tracks: 0, albums: 0, playlists: 0, artists: 0, total: 0, recentTracks: 0, previousTracks: 0, lastUsedAt: null,
    });
  }
  return tags;
}

function computeStreaks(activeDays: Set<string>, now: number) {
  const sorted = [...activeDays].sort();
  let longest = 0;
  let run = 0;
  let previous: number | null = null;
  for (const day of sorted) {
    const [year, month, date] = day.split("-").map(Number);
    const time = new Date(year, month - 1, date).getTime();
    run = previous !== null && addDays(previous, 1) === time ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = time;
  }
  let current = 0;
  const today = startOfLocalDay(now);
  // A streak still counts if today hasn't been tagged yet but yesterday was.
  let cursor = activeDays.has(dayKey(today)) ? today : addDays(today, -1);
  while (activeDays.has(dayKey(cursor))) {
    current += 1;
    cursor = addDays(cursor, -1);
  }
  return { current, longest };
}

export function computeLibraryStats(tagData: TagDataStructure, range: StatsRange, now: number, baseline: StatsBaseline | null = null): LibraryStats {
  const start = rangeStart(range, now);
  const tags = resolveTags(tagData);
  const recentStart = addDays(now, -(GROWTH_WINDOW_DAYS - 1));
  const previousStart = addDays(recentStart, -GROWTH_WINDOW_DAYS);

  const tracks = statsTrackEntries(tagData.tracks, baseline).filter(([, track]) => isAnnotated(track));
  const undatedTracks = tracks.filter(([, track]) => typeof track.dateCreated !== "number").length;
  const scoped = tracks.filter(([, track]) => inRange(track.dateCreated, start));

  const ratingCounts = new Map<number, number>();
  const energyCounts = new Map<number, number>();
  const keyCounts = new Map<string, number>();
  const bpmValues: number[] = [];
  const ratings: number[] = [];
  const artistTotals = new Map<string, { tracks: number; ratings: number[] }>();
  const albumTotals = new Map<string, { uri: string; name: string; artists: string; imageUrl: string | null; tracks: number }>();
  const pairCounts = new Map<string, number>();
  const tagRatings = new Map<string, number[]>();
  const taggedUnrated: string[] = [];
  const ratedUntagged: string[] = [];
  const missingEnergy: string[] = [];
  let taggedTracks = 0, ratedTracks = 0, energyTracks = 0, bpmTracks = 0, keyTracks = 0, completeTracks = 0, localTracks = 0, tagAssignments = 0;

  for (const [uri, track] of scoped) {
    const tagIds = [...new Set(track.tagIds)].filter((id) => tags.has(id));
    if (uri.startsWith("spotify:local:")) localTracks += 1;
    if (tagIds.length) { taggedTracks += 1; tagAssignments += tagIds.length; }
    if (track.rating > 0) {
      ratedTracks += 1; ratings.push(track.rating);
      ratingCounts.set(track.rating, (ratingCounts.get(track.rating) ?? 0) + 1);
    }
    if (track.energy > 0) { energyTracks += 1; energyCounts.set(track.energy, (energyCounts.get(track.energy) ?? 0) + 1); }
    if (typeof track.bpm === "number" && track.bpm > 0) { bpmTracks += 1; bpmValues.push(track.bpm); }
    const key = track.camelotKey?.toUpperCase();
    if (key && CAMELOT_KEYS.includes(key)) { keyTracks += 1; keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1); }
    if (tagIds.length && track.rating > 0 && track.energy > 0) completeTracks += 1;
    if (tagIds.length && track.rating <= 0) taggedUnrated.push(uri);
    if (!tagIds.length && track.rating > 0) ratedUntagged.push(uri);
    if (tagIds.length && track.energy <= 0) missingEnergy.push(uri);

    for (const id of tagIds) {
      const tag = tags.get(id)!;
      tag.tracks += 1;
      if (track.rating > 0) {
        const values = tagRatings.get(id) ?? [];
        values.push(track.rating);
        tagRatings.set(id, values);
      }
      if (typeof track.dateCreated === "number") {
        if (track.dateCreated >= recentStart) tag.recentTracks += 1;
        else if (track.dateCreated >= previousStart) tag.previousTracks += 1;
      }
      const touched = track.dateModified ?? track.dateCreated;
      if (typeof touched === "number" && (tag.lastUsedAt === null || touched > tag.lastUsedAt)) tag.lastUsedAt = touched;
    }
    const sortedIds = [...tagIds].sort();
    for (let left = 0; left < sortedIds.length; left++) {
      for (let right = left + 1; right < sortedIds.length; right++) {
        const pair = `${sortedIds[left]}\u0000${sortedIds[right]}`;
        pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
      }
    }
    if (tagIds.length) {
      for (const name of trackArtists(track)) {
        const entry = artistTotals.get(name) ?? { tracks: 0, ratings: [] };
        entry.tracks += 1;
        if (track.rating > 0) entry.ratings.push(track.rating);
        artistTotals.set(name, entry);
      }
      if (track.albumUri) {
        const entry = albumTotals.get(track.albumUri) ?? { uri: track.albumUri, name: track.albumName || "Unknown album", artists: track.artists ?? "", imageUrl: track.albumImageUrl ?? null, tracks: 0 };
        entry.tracks += 1;
        albumTotals.set(track.albumUri, entry);
      }
    }
  }

  // Albums and playlists share one map; album URIs mark album annotations.
  let albums = 0, playlists = 0, artists = 0;
  for (const [uri, entity] of Object.entries(tagData.playlists)) {
    if (!inRange(entity.dateCreated, start) || !(entity.tagIds.length || entity.rating > 0 || entity.energy > 0)) continue;
    const isAlbum = uri.startsWith("spotify:album:");
    if (isAlbum) albums += 1; else playlists += 1;
    for (const id of new Set(entity.tagIds)) {
      const tag = tags.get(id);
      if (tag) { if (isAlbum) tag.albums += 1; else tag.playlists += 1; }
    }
  }
  for (const entity of Object.values(tagData.artists)) {
    if (!inRange(entity.dateCreated, start) || !(entity.tagIds.length || entity.rating > 0 || entity.energy > 0)) continue;
    artists += 1;
    for (const id of new Set(entity.tagIds)) { const tag = tags.get(id); if (tag) tag.artists += 1; }
  }

  const allTags = [...tags.values()];
  for (const tag of allTags) tag.total = tag.tracks + tag.albums + tag.playlists + tag.artists;
  const byUse = (left: StatsTag, right: StatsTag) => right.total - left.total || left.name.localeCompare(right.name);

  const categories = tagData.taxonomy.categoryOrder.flatMap((id) => {
    const category = tagData.taxonomy.categoriesById[id];
    if (!category) return [];
    const members = allTags.filter((tag) => tag.categoryId === id);
    return [{ id, name: category.name, uses: members.reduce((sum, tag) => sum + tag.total, 0), tags: members.length, usedTags: members.filter((tag) => tag.total > 0).length }];
  });

  const pairs = [...pairCounts].sort((left, right) => right[1] - left[1]).slice(0, PAIR_LIMIT).map(([pair, count]) => {
    const [a, b] = pair.split("\u0000");
    return { a: tags.get(a)!, b: tags.get(b)!, tracks: count };
  });

  // Activity always shows when tracks were first tagged, whatever the range.
  const dayCounts = new Map<string, number>();
  const hours = Array(24).fill(0) as number[];
  let lastTaggedAt: number | null = null;
  for (const [, track] of tracks) {
    if (typeof track.dateCreated !== "number") continue;
    if (inRange(track.dateCreated, start)) hours[new Date(track.dateCreated).getHours()] += 1;
    const key = dayKey(track.dateCreated);
    dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
    if (lastTaggedAt === null || track.dateCreated > lastTaggedAt) lastTaggedAt = track.dateCreated;
  }
  const today = startOfLocalDay(now);
  // The heatmap starts on the Sunday 53 weeks back so each column is one week.
  const heatmapStart = addDays(today, -((HEATMAP_WEEKS - 1) * 7 + new Date(today).getDay()));
  const days: Array<{ date: string; count: number }> = [];
  for (let cursor = heatmapStart; cursor <= today; cursor = addDays(cursor, 1)) {
    const key = dayKey(cursor);
    days.push({ date: key, count: dayCounts.get(key) ?? 0 });
  }
  const scopedDays = [...dayCounts].filter(([date]) => {
    if (start === null) return true;
    const [year, month, day] = date.split("-").map(Number);
    return new Date(year, month - 1, day).getTime() >= start;
  });
  const weekdays = Array(7).fill(0) as number[];
  for (const [date, count] of scopedDays) {
    const [year, month, day] = date.split("-").map(Number);
    weekdays[new Date(year, month - 1, day).getDay()] += count;
  }
  const busiest = scopedDays.reduce<[string, number] | null>((best, entry) => !best || entry[1] > best[1] || (entry[1] === best[1] && entry[0] > best[0]) ? entry : best, null);
  const firstMonth = [...dayCounts.keys()].sort()[0]?.slice(0, 7);
  const monthsSinceFirst = firstMonth
    ? (new Date(now).getFullYear() - Number(firstMonth.slice(0, 4))) * 12 + new Date(now).getMonth() + 1 - Number(firstMonth.slice(5, 7)) + 1
    : 1;
  // All time starts at the first month you tagged (at least six months, at most two years).
  // Ranges include the month they start in, so every counted track shows in the month chart.
  const monthsSinceStart = start === null ? 1
    : (new Date(now).getFullYear() - new Date(start).getFullYear()) * 12 + new Date(now).getMonth() - new Date(start).getMonth() + 1;
  const monthCount = range === "all" ? Math.min(24, Math.max(6, monthsSinceFirst)) : monthsSinceStart;
  const monthTotals = new Map<string, number>();
  for (const [date, count] of dayCounts) monthTotals.set(date.slice(0, 7), (monthTotals.get(date.slice(0, 7)) ?? 0) + count);
  const streaks = computeStreaks(new Set(dayCounts.keys()), now);

  return {
    range,
    undatedTracks,
    overview: {
      tracks: scoped.length, taggedTracks, ratedTracks, energyTracks, bpmTracks, keyTracks, completeTracks, localTracks,
      albums, playlists, artists,
      tagsTotal: allTags.length,
      tagsUsed: allTags.filter((tag) => tag.total > 0).length,
      tagsColored: allTags.filter((tag) => tag.color).length,
      categories: categories.length,
      averageTagsPerTaggedTrack: taggedTracks ? tagAssignments / taggedTracks : 0,
      averageRating: average(ratings),
    },
    activity: {
      days,
      months: recentMonths(now, Math.max(monthCount, 1)).map((month) => ({ month, count: monthTotals.get(month) ?? 0 })),
      weekdays,
      hours,
      currentStreak: streaks.current,
      longestStreak: streaks.longest,
      busiestDay: busiest ? { date: busiest[0], count: busiest[1] } : null,
      activeDays: scopedDays.length,
      lastTaggedAt,
    },
    tags: {
      all: [...allTags].sort(byUse),
      top: allTags.filter((tag) => tag.total > 0).sort(byUse).slice(0, TOP_LIMIT),
      rising: allTags.filter((tag) => tag.recentTracks > tag.previousTracks)
        .sort((left, right) => (right.recentTracks - right.previousTracks) - (left.recentTracks - left.previousTracks) || byUse(left, right)).slice(0, TOP_LIMIT),
      unused: allTags.filter((tag) => tag.total === 0).sort((left, right) => left.path.localeCompare(right.path)),
      stale: allTags.filter((tag) => tag.tracks > 0 && tag.lastUsedAt !== null && tag.lastUsedAt < now - STALE_TAG_DAYS * DAY_MS)
        .sort((left, right) => (left.lastUsedAt ?? 0) - (right.lastUsedAt ?? 0)).slice(0, TOP_LIMIT),
      categories,
      pairs,
    },
    ratings: {
      distribution: RATING_STEPS.map((rating) => ({ rating, count: ratingCounts.get(rating) ?? 0 })),
      tagAverages: allTags.flatMap((tag) => {
        const values = tagRatings.get(tag.id) ?? [];
        return values.length >= MIN_TRACKS_FOR_TAG_AVERAGE ? [{ tag, average: average(values)!, tracks: values.length }] : [];
      }).sort((left, right) => right.average - left.average || right.tracks - left.tracks),
      taggedUnrated,
      ratedUntagged,
      missingEnergy,
    },
    music: {
      artists: [...artistTotals].map(([name, entry]) => ({ name, tracks: entry.tracks, averageRating: average(entry.ratings) }))
        .sort((left, right) => right.tracks - left.tracks || left.name.localeCompare(right.name)).slice(0, TOP_LIMIT),
      albums: [...albumTotals.values()].sort((left, right) => right.tracks - left.tracks || left.name.localeCompare(right.name)).slice(0, TOP_LIMIT),
      bpm: BPM_BUCKETS.map((bucket) => ({
        label: bucket.label,
        count: bpmValues.filter((bpm) => (bucket.min === null || bpm >= bucket.min) && (bucket.max === null || bpm < bucket.max)).length,
      })),
      averageBpm: average(bpmValues),
      energy: ENERGY_STEPS.map((energy) => ({ energy, count: energyCounts.get(energy) ?? 0 })),
      keys: CAMELOT_KEYS.map((key) => ({ key, count: keyCounts.get(key) ?? 0 })),
    },
  };
}

export function computeTagDetail(tagData: TagDataStructure, stats: LibraryStats, tagId: string, now: number, baseline: StatsBaseline | null = null): TagDetail | null {
  const tag = stats.tags.all.find((candidate) => candidate.id === tagId);
  if (!tag) return null;
  const start = rangeStart(stats.range, now);
  const tagged = statsTrackEntries(tagData.tracks, baseline)
    .filter(([, track]) => track.tagIds.includes(tagId) && inRange(track.dateCreated, start));
  const tagsById = new Map(stats.tags.all.map((candidate) => [candidate.id, candidate]));
  const months = recentMonths(now, 12);
  const monthCounts = new Map<string, number>();
  const ratingCounts = new Map<number, number>();
  const companions = new Map<string, number>();
  const artists = new Map<string, number>();
  const ratings: number[] = [];
  for (const [, track] of tagged) {
    if (typeof track.dateCreated === "number") monthCounts.set(monthKey(track.dateCreated), (monthCounts.get(monthKey(track.dateCreated)) ?? 0) + 1);
    if (track.rating > 0) { ratings.push(track.rating); ratingCounts.set(track.rating, (ratingCounts.get(track.rating) ?? 0) + 1); }
    for (const other of new Set(track.tagIds)) if (other !== tagId && tagsById.has(other)) companions.set(other, (companions.get(other) ?? 0) + 1);
    for (const name of trackArtists(track)) artists.set(name, (artists.get(name) ?? 0) + 1);
  }
  const recent = [...tagged].sort((left, right) => (right[1].dateModified ?? right[1].dateCreated ?? 0) - (left[1].dateModified ?? left[1].dateCreated ?? 0));
  return {
    tag,
    months: months.map((month) => ({ month, count: monthCounts.get(month) ?? 0 })),
    ratings: RATING_STEPS.map((rating) => ({ rating, count: ratingCounts.get(rating) ?? 0 })),
    averageRating: average(ratings),
    companions: [...companions].sort((left, right) => right[1] - left[1]).slice(0, 8)
      .map(([id, count]) => ({ tag: tagsById.get(id)!, tracks: count, share: tagged.length ? count / tagged.length : 0 })),
    artists: [...artists].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 8).map(([name, tracks]) => ({ name, tracks })),
    recent: recent.slice(0, 12).map(([uri, track]) => ({
      uri, name: track.name || (uri.startsWith("spotify:local:") ? decodeURIComponent(uri.split(":")[4] ?? "Local file").replace(/\+/g, " ") : "Unknown track"),
      artists: track.artists ?? "", imageUrl: track.albumImageUrl ?? null, rating: track.rating, dateCreated: track.dateCreated ?? null,
    })),
    trackUris: recent.map(([uri]) => uri),
  };
}

/** Something in Stats a member can open to see the tracks behind it. */
export type StatsSelection =
  | { kind: "taggedUnrated" } | { kind: "ratedUntagged" } | { kind: "missingEnergy" }
  /** A tag, optionally narrowed to one month, rating or artist from its detail page. */
  | { kind: "tag"; tagId: string; month?: string; rating?: number; artist?: string } | { kind: "pair"; tagIds: [string, string] } | { kind: "category"; categoryId: string }
  | { kind: "rating"; rating: number } | { kind: "energy"; energy: number } | { kind: "bpm"; label: string } | { kind: "key"; key: string }
  | { kind: "artist"; name: string } | { kind: "album"; uri: string }
  | { kind: "day"; date: string } | { kind: "month"; month: string };

/**
 * The tracks a selection counts, most recently changed first. Activity selections (a day or a
 * month) cover all dated tracks, like the calendar; everything else follows the chosen range.
 */
export function selectStatsTracks(tagData: TagDataStructure, range: StatsRange, now: number, selection: StatsSelection, baseline: StatsBaseline | null = null): string[] {
  const start = rangeStart(range, now);
  const lookup = selection.kind === "category" ? buildResolvedTagLookup(tagData.taxonomy) : null;
  const bucket = selection.kind === "bpm" ? BPM_BUCKETS.find((candidate) => candidate.label === selection.label) : null;
  const matches = (track: TrackData): boolean => {
    const tags = track.tagIds;
    switch (selection.kind) {
      case "taggedUnrated": return tags.length > 0 && track.rating <= 0;
      case "ratedUntagged": return tags.length === 0 && track.rating > 0;
      case "missingEnergy": return tags.length > 0 && track.energy <= 0;
      case "tag": return tags.includes(selection.tagId)
        && (selection.month === undefined || (typeof track.dateCreated === "number" && monthKey(track.dateCreated) === selection.month))
        && (selection.rating === undefined || track.rating === selection.rating)
        && (selection.artist === undefined || trackArtists(track).includes(selection.artist));
      case "pair": return selection.tagIds.every((id) => tags.includes(id));
      case "category": return tags.some((id) => lookup!.get(id)?.category.id === selection.categoryId);
      case "rating": return track.rating === selection.rating;
      case "energy": return track.energy === selection.energy;
      case "bpm": return !!bucket && typeof track.bpm === "number" && track.bpm > 0
        && (bucket.min === null || track.bpm >= bucket.min) && (bucket.max === null || track.bpm < bucket.max);
      case "key": return track.camelotKey?.toUpperCase() === selection.key;
      case "artist": return tags.length > 0 && trackArtists(track).includes(selection.name);
      case "album": return tags.length > 0 && track.albumUri === selection.uri;
      case "day": return typeof track.dateCreated === "number" && dayKey(track.dateCreated) === selection.date;
      case "month": return typeof track.dateCreated === "number" && monthKey(track.dateCreated) === selection.month;
    }
  };
  const activity = selection.kind === "day" || selection.kind === "month";
  return statsTrackEntries(tagData.tracks, baseline)
    .filter(([, track]) => isAnnotated(track) && (activity || inRange(track.dateCreated, start)) && matches(track))
    .sort((left, right) => (right[1].dateModified ?? right[1].dateCreated ?? 0) - (left[1].dateModified ?? left[1].dateCreated ?? 0))
    .map(([uri]) => uri);
}

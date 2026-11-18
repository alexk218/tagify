/**
 * Song details Tagify fills in from Spotify (length and the album's release
 * date) and the filters that use them. Shared by the track list and Smart
 * Playlists so both match songs the same way.
 */

/** Spotify's release date at the precision Spotify knows it: "2024", "2024-06" or "2024-06-01". */
export function releaseDate(date: unknown): string | null {
  if (!date || typeof date !== "object") return null;
  const { isoString, precision, year } = date as { isoString?: unknown; precision?: unknown; year?: unknown };
  const iso = typeof isoString === "string" && /^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(isoString) ? isoString : null;
  const known = typeof precision === "string" ? precision.toUpperCase() : null;
  if (iso && known === "DAY") return iso.slice(0, 10);
  if (iso && known === "MONTH") return iso.slice(0, 7);
  if (iso && known === "YEAR") return iso.slice(0, 4);
  // Without a precision only the year is certain: Spotify fills unknown months and days with 01.
  if (typeof year === "number" && Number.isInteger(year) && year >= 1000 && year <= 9999) return String(year);
  return iso ? iso.slice(0, 4) : null;
}

/** A plausible song length in milliseconds (1 ms to 24 hours), otherwise null. */
export function songDurationMs(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 86_400_000 ? value : null;
}

export function normalizeReleaseDate(value: unknown): string | null {
  return typeof value === "string" && /^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$/.test(value) ? value : null;
}

export function releaseYearOf(value: string | null | undefined): number | null {
  const date = normalizeReleaseDate(value);
  return date ? Number(date.slice(0, 4)) : null;
}

/**
 * The year the Released filter and Smart Playlists use: the earlier of the song's original release
 * (from Tagify Community, for a linked library) and its album's, so a 2011 remaster of a 1977 song
 * counts as 1977. Without an original date it is the album's year.
 */
export function filterReleaseYearOf(track: { releaseDate?: string | null; originalReleaseDate?: string | null }): number | null {
  const album = releaseYearOf(track.releaseDate);
  const original = releaseYearOf(track.originalReleaseDate);
  if (album === null) return original;
  return original === null ? album : Math.min(album, original);
}

/** Length filters are whole seconds; release year filters are years. Missing means "any". */
export interface SongDetailFilterCriteria {
  lengthMinFilter?: number | null;
  lengthMaxFilter?: number | null;
  releaseYearMinFilter?: number | null;
  releaseYearMaxFilter?: number | null;
}

export const EMPTY_SONG_DETAIL_FILTERS: Required<SongDetailFilterCriteria> = {
  lengthMinFilter: null,
  lengthMaxFilter: null,
  releaseYearMinFilter: null,
  releaseYearMaxFilter: null,
};

export const SONG_DETAIL_FILTER_FIELDS = ["lengthMinFilter", "lengthMaxFilter", "releaseYearMinFilter", "releaseYearMaxFilter"] as const;

/** Bounds a saved or shared filter value must fall within. */
export const SONG_DETAIL_FILTER_BOUNDS: Record<(typeof SONG_DETAIL_FILTER_FIELDS)[number], [number, number]> = {
  lengthMinFilter: [0, 86_400],
  lengthMaxFilter: [0, 86_400],
  releaseYearMinFilter: [1000, 9999],
  releaseYearMaxFilter: [1000, 9999],
};

/** Song length choices offered by the filter, in seconds. */
export const LENGTH_FILTER_OPTIONS = [60, 120, 150, 180, 210, 240, 270, 300, 360, 420, 480, 600, 900, 1200];

/** Only the filters in use, so playlists without them keep their earlier saved shape. */
export function compactSongDetailFilters(criteria: SongDetailFilterCriteria): SongDetailFilterCriteria {
  return Object.fromEntries(SONG_DETAIL_FILTER_FIELDS.flatMap((field) =>
    typeof criteria[field] === "number" ? [[field, criteria[field]]] : [])) as SongDetailFilterCriteria;
}

export function hasSongDetailFilters(criteria: SongDetailFilterCriteria): boolean {
  return SONG_DETAIL_FILTER_FIELDS.some((field) => typeof criteria[field] === "number");
}

/**
 * Whether a song passes the length and release year filters. A song whose
 * length or release date isn't known yet doesn't match a filter on it, the
 * same way songs without a BPM don't match a BPM filter.
 */
export function matchesSongDetailFilters(
  track: { durationMs?: number; releaseDate?: string; originalReleaseDate?: string },
  criteria: SongDetailFilterCriteria,
): boolean {
  const { lengthMinFilter, lengthMaxFilter, releaseYearMinFilter, releaseYearMaxFilter } = criteria;
  if (typeof lengthMinFilter === "number" || typeof lengthMaxFilter === "number") {
    const durationMs = songDurationMs(track.durationMs);
    if (durationMs === null) return false;
    const seconds = durationMs / 1000;
    if (typeof lengthMinFilter === "number" && seconds < lengthMinFilter) return false;
    // "To 4:00" includes 4:00.9; Spotify rounds lengths down to the second.
    if (typeof lengthMaxFilter === "number" && Math.floor(seconds) > lengthMaxFilter) return false;
  }
  if (typeof releaseYearMinFilter === "number" || typeof releaseYearMaxFilter === "number") {
    const year = filterReleaseYearOf(track);
    if (year === null) return false;
    if (typeof releaseYearMinFilter === "number" && year < releaseYearMinFilter) return false;
    if (typeof releaseYearMaxFilter === "number" && year > releaseYearMaxFilter) return false;
  }
  return true;
}

/** "3:05" for 185 seconds. */
export function formatLength(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * What someone typed into a From/To filter field: a value, `null` for "Any"
 * (an empty field or the word "any"), or `undefined` when it can't be read.
 */
export type TypedFilterValue = number | null | undefined;

function isAny(text: string): boolean {
  return text === "" || text === "any";
}

/**
 * A typed song length in seconds. Accepts "3:30", "1:02:00", plain minutes
 * ("4", "3.5", "4 min") and seconds ("210s").
 */
export function parseLengthInput(text: string): TypedFilterValue {
  const value = text.trim().toLowerCase();
  if (isAny(value)) return null;
  let seconds: number | undefined;
  const clock = /^(?:(\d{1,2}):)?(\d{1,3}):([0-5]\d)$/.exec(value);
  const plainSeconds = /^(\d{1,5})\s*(?:s|sec|secs|seconds?)$/.exec(value);
  const minutes = /^(\d{1,4}(?:[.,]\d+)?)\s*(?:m|min|mins|minutes?)?$/.exec(value);
  if (clock) seconds = Number(clock[1] ?? 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
  else if (plainSeconds) seconds = Number(plainSeconds[1]);
  else if (minutes) seconds = Math.round(Number(minutes[1].replace(",", ".")) * 60);
  const [low, high] = SONG_DETAIL_FILTER_BOUNDS.lengthMinFilter;
  return seconds !== undefined && seconds >= low && seconds <= high ? seconds : undefined;
}

/** A typed release year, such as "1995". */
export function parseYearInput(text: string): TypedFilterValue {
  const value = text.trim().toLowerCase();
  if (isAny(value)) return null;
  if (!/^\d{4}$/.test(value)) return undefined;
  const year = Number(value);
  const [low, high] = SONG_DETAIL_FILTER_BOUNDS.releaseYearMinFilter;
  return year >= low && year <= high ? year : undefined;
}

/** A typed BPM, rounded to a whole beat ("124", "127.5", "124 bpm"). */
export function parseBpmInput(text: string): TypedFilterValue {
  const value = text.trim().toLowerCase().replace(/\s*bpm$/, "");
  if (isAny(value)) return null;
  if (!/^\d{1,3}(?:[.,]\d+)?$/.test(value)) return undefined;
  const bpm = Math.round(Number(value.replace(",", ".")));
  return bpm >= 1 && bpm <= 999 ? bpm : undefined;
}

function rangeLabel(
  min: number | null | undefined,
  max: number | null | undefined,
  format: (value: number) => string,
  words: { atLeast: string; atMost: (value: string) => string },
): string | null {
  const hasMin = typeof min === "number", hasMax = typeof max === "number";
  if (hasMin && hasMax) return min === max ? format(min) : `${format(min)}–${format(max)}`;
  if (hasMin) return `${format(min)} ${words.atLeast}`;
  if (hasMax) return words.atMost(format(max));
  return null;
}

/** The active filters as label and value, such as { label: "Length", value: "3:00–5:00" }. */
export function songDetailFilterParts(criteria: SongDetailFilterCriteria): Array<{ label: string; value: string }> {
  const length = rangeLabel(criteria.lengthMinFilter, criteria.lengthMaxFilter, formatLength,
    { atLeast: "or longer", atMost: (value) => `up to ${value}` });
  const year = rangeLabel(criteria.releaseYearMinFilter, criteria.releaseYearMaxFilter, String,
    { atLeast: "or later", atMost: (value) => `${value} or earlier` });
  return [...(length ? [{ label: "Length", value: length }] : []), ...(year ? [{ label: "Released", value: year }] : [])];
}

/** Plain-language descriptions of the active filters, such as "Length 3:00–5:00". */
export function songDetailFilterLabels(criteria: SongDetailFilterCriteria): string[] {
  return songDetailFilterParts(criteria).map(({ label, value }) => `${label} ${value}`);
}

/** Keeps only valid song detail filters, so a damaged or hand-edited file can't add impossible ones. */
export function normalizeSongDetailFilters(value: unknown): SongDetailFilterCriteria {
  const candidate = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const result: SongDetailFilterCriteria = {};
  for (const field of SONG_DETAIL_FILTER_FIELDS) {
    const raw = candidate[field];
    const [min, max] = SONG_DETAIL_FILTER_BOUNDS[field];
    if (raw === null) result[field] = null;
    else if (typeof raw === "number" && Number.isInteger(raw) && raw >= min && raw <= max) result[field] = raw;
  }
  return result;
}

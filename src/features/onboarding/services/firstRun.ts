import type { TagDataStructure } from "@/types/tagData";

// Only people who picked a song from "Tag your first song" on this device see the payoff,
// so existing libraries never get it after an update.
const FIRST_RUN_KEY = "tagify:first-run:v2";
// 3.3.3 marked a first run whenever the card would show, including while an existing library was
// still loading, so its markers can't tell real first runs apart and are dropped.
const STALE_FIRST_RUN_KEY = "tagify:first-run:v1";
type FirstRunState = "started" | "done";

function read(): FirstRunState | null {
  try {
    localStorage.removeItem(STALE_FIRST_RUN_KEY);
    const value = localStorage.getItem(FIRST_RUN_KEY);
    return value === "started" || value === "done" ? value : null;
  } catch { return null; }
}

function write(state: FirstRunState): void {
  try { localStorage.setItem(FIRST_RUN_KEY, state); } catch { /* The payoff may then show again next time. */ }
}

export const markFirstRunStarted = () => { if (read() === null) write("started"); };
export const markFirstRunDone = () => write("done");
export const isFirstRunInProgress = () => read() === "started";

export const PAYOFF_MIN_TAGGED = 3;

/** The tag used on the most songs, so the filter shows more than one result. Ties go to the tag counted first. */
export function mostUsedTag(tagData: Pick<TagDataStructure, "tracks" | "taxonomy">): { id: string; name: string; songs: number } | null {
  const counts = new Map<string, number>();
  for (const track of Object.values(tagData.tracks)) {
    for (const id of new Set(track.tagIds)) {
      if (tagData.taxonomy.tagsById[id]) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  let best: { id: string; songs: number } | null = null;
  for (const [id, songs] of counts) if (!best || songs > best.songs) best = { id, songs };
  return best ? { ...best, name: tagData.taxonomy.tagsById[best.id].name } : null;
}

// Moods first, then broad genres: the starter tags most songs fit at a glance.
const QUICK_TAG_NAMES = ["Chill", "Upbeat", "Happy", "Sad", "Party", "Nostalgic", "Pop", "Rock", "Electronic", "Hip-Hop"];

/**
 * A handful of the member's own tags to add with one click on "Tag your first song": the starter
 * moods and genres they still have, else their first tags.
 */
export function quickTags(taxonomy: TagDataStructure["taxonomy"], limit = 5): { id: string; name: string }[] {
  const tags = Object.values(taxonomy.tagsById);
  const byName = new Map(tags.map((tag) => [tag.name.toLocaleLowerCase(), tag]));
  const picked: { id: string; name: string }[] = [];
  for (const name of QUICK_TAG_NAMES) {
    const tag = byName.get(name.toLocaleLowerCase());
    if (tag && picked.length < limit) picked.push({ id: tag.id, name: tag.name });
  }
  for (const tag of tags) {
    if (picked.length >= limit) break;
    if (!picked.some((existing) => existing.id === tag.id)) picked.push({ id: tag.id, name: tag.name });
  }
  return picked;
}

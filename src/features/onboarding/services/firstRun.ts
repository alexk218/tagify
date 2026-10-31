import type { TagDataStructure } from "@/types/tagData";

// Only people who started from "Tag your first song" on this device see the payoff,
// so existing libraries never get it after an update.
const FIRST_RUN_KEY = "tagify:first-run:v1";
type FirstRunState = "started" | "done";

function read(): FirstRunState | null {
  try {
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

import { createContext } from "react";
import type { TagSearchMatch } from "../tagSearch/tagSearchClient";

export interface ChosenTags { tags: string[]; match: TagSearchMatch }
/** A tag name other members used on the member's songs, and on how many. */
export interface TagNameCount { label: string; songs: number }

/** What the "Your songs" list and the view around it share. */
export interface OthersHomeReports {
  /** How many songs the list found. */
  onFound?: (songs: number) => void;
  /** The names other members used on the member's songs, most songs first. */
  onTagNames?: (names: readonly TagNameCount[]) => void;
  /**
   * The tags chosen for both lists, picked above the list. While set, "Your songs" shows only songs
   * other members tagged that way, and leaves picking tag names to that bar.
   */
  tags?: { chosen: ChosenTags; onChoose: (chosen: ChosenTags) => void };
}

export const OthersHomeContext = createContext<OthersHomeReports>({});

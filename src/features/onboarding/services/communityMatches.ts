import type { SpotifyTrack } from "@/types/SpotifyTypes";

export interface CommunityMatchTag {
  label: string;
  /** Where people keep it, "Category / Folder / Tag", most people first, to file it the same way. */
  paths: string[];
  people: number;
}

/** A song of yours other people tagged, with their tags. */
export interface CommunityMatch {
  track: SpotifyTrack;
  tags: CommunityMatchTag[];
}

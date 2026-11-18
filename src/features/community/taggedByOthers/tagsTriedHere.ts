import type { TagDataStructure } from "@/types/tagData";

/**
 * Whether nothing in the library uses this tag: no song, playlist, artist, smart playlist or saved
 * filter. Tag ids are unique random ids, so finding the quoted id anywhere means it is in use.
 */
export function tagIsUnused(data: Pick<TagDataStructure, "tracks" | "playlists" | "artists" | "smartPlaylists">, tagId: string, filters: readonly string[] = []): boolean {
  if (filters.includes(tagId)) return false;
  const quoted = JSON.stringify(tagId);
  return ![data.tracks, data.playlists, data.artists, data.smartPlaylists ?? []].some((part) => JSON.stringify(part).includes(quoted));
}

/**
 * Tags "Tagged by others" created for a song while trying members' tags. Once the member moves on
 * from that song (when its Undo history ends), a tag they took off again and nothing else uses is
 * deleted, so trying a tag leaves no clutter. Tags that existed before are never deleted.
 */
export class TagsTriedHere {
  private created = new Map<string, string>();

  /** `tagId` was created for `uri` just now. */
  note(tagId: string, uri: string) { this.created.set(tagId, uri); }

  /** Tags created for songs other than `keepUri` that nothing uses now; they are forgotten either way. */
  takeUnused(keepUri: string | null, isUnused: (tagId: string) => boolean): string[] {
    const unused: string[] = [];
    for (const [tagId, uri] of [...this.created]) {
      if (uri === keepUri) continue;
      this.created.delete(tagId);
      if (isUnused(tagId)) unused.push(tagId);
    }
    return unused;
  }
}

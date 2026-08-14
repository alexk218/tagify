// Legacy helpers kept only so older imports continue to compile during the
// transition to stable tag IDs. New code should use the tag ID string directly.

export interface ParsedTagId {
  tagId: string;
}

export function createTagId(tagId: string): string {
  return tagId;
}

export function createTrackTagId(tagId: string): string {
  return tagId;
}

export function parseTagId(tagId: string): ParsedTagId | null {
  return tagId ? { tagId } : null;
}

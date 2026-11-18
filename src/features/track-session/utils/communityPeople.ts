import type { TaggedByOthersItem } from "@/features/community/taggedByOthers/taggedByOthersScan";

/** Other members' most used tags shown on a tagged-tracks row; the rest show as "+N". */
export const COMMUNITY_ROW_TAGS = 3;

/** "1 other", "12 others", "50+ others". */
export function formatCommunityPeople({ people, peopleCapped }: Pick<TaggedByOthersItem, "people" | "peopleCapped">): string {
  return `${people}${peopleCapped ? "+" : ""} ${people === 1 && !peopleCapped ? "other" : "others"}`;
}

/** The chip's tooltip: who tagged it and their most used tags. */
export function communityPeopleTitle(item: Pick<TaggedByOthersItem, "people" | "peopleCapped" | "sample" | "tags">): string {
  const named = item.sample.map((handle) => `@${handle}`);
  const rest = item.people - named.length;
  const who = named.length
    ? `${named.join(", ")}${rest > 0 ? ` and ${rest}${item.peopleCapped ? "+" : ""} more` : ""}`
    : formatCommunityPeople(item);
  const tags = item.tags.slice(0, 5).map((tag) => tag.label).join(", ");
  return `Tagged on Community by ${who}${tags ? `\nTheir tags: ${tags}` : ""}`;
}

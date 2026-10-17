import { useEffect, useState } from "react";
import type { PopularTagName } from "@tagify/community-contracts";
import {
  COMMUNITY_POPULAR_TAGS_UPDATED_EVENT,
  getCommunityPopularTags,
  preloadCommunityPopularTags,
} from "@/features/tag-data/utils/communityPopularTags";

/** The tag names other members use, updated when a fresh list arrives. */
export function useCommunityPopularTags(): readonly PopularTagName[] {
  const [names, setNames] = useState(() => getCommunityPopularTags());
  useEffect(() => {
    const update = () => setNames(getCommunityPopularTags());
    window.addEventListener(COMMUNITY_POPULAR_TAGS_UPDATED_EVENT, update);
    // Normally downloaded when Tagify starts; this only asks if that didn't happen or is a day old.
    void preloadCommunityPopularTags();
    return () => window.removeEventListener(COMMUNITY_POPULAR_TAGS_UPDATED_EVENT, update);
  }, []);
  return names;
}

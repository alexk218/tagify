import { useEffect, useState } from "react";
import { taggedByOthersStore, type TaggedByOthersStore } from "@/features/community/taggedByOthers/taggedByOthersStore";
import { getDesktopSyncConfiguration } from "@/services/sync/SyncLocalState";
import { rankTagsForYourSongs, type TagForYourSongs } from "@/features/tag-data/utils/communityCatalogForYou";

export interface TagsForYourSongs {
  /** "none" when this computer has no "Tagged by others" check for your songs yet. */
  status: "loading" | "none" | "ready";
  tags: TagForYourSongs[];
}

/**
 * Tags other people put on your songs, from the last "Tagged by others" check saved on this
 * computer. Reads only what that check saved; it never asks Spotify or Community itself.
 */
export function useTagsForYourSongs(
  enabled: boolean,
  store: TaggedByOthersStore = taggedByOthersStore,
  account: () => string | null = () => getDesktopSyncConfiguration()?.accountId || null,
): TagsForYourSongs {
  const [state, setState] = useState<TagsForYourSongs>({ status: "loading", tags: [] });
  const accountId = enabled ? account() : null;

  useEffect(() => {
    if (!enabled) return;
    if (!accountId) {
      setState({ status: "none", tags: [] });
      return;
    }
    let cancelled = false;
    store.load(accountId).then(
      (saved) => {
        if (cancelled) return;
        const tags = saved ? rankTagsForYourSongs(saved.outcome.matches) : [];
        setState({ status: tags.length ? "ready" : "none", tags });
      },
      () => { if (!cancelled) setState({ status: "none", tags: [] }); },
    );
    return () => { cancelled = true; };
  }, [enabled, store, accountId]);

  return state;
}

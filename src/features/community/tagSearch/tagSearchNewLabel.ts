import { useCallback, useState } from "react";

const SEEN_KEY = "tagify:new-feature-seen:community-tag-search";

/** Alex's pick 2A (2026-11-23): a plain "New" next to the way in, shown to everyone until they open it once on this computer. */
export function useTagSearchNewLabel(): { show: boolean; dismiss: () => void } {
  const [seen, setSeen] = useState(() => {
    try { return localStorage.getItem(SEEN_KEY) !== null; } catch { return true; }
  });
  const dismiss = useCallback(() => {
    setSeen(true);
    try { localStorage.setItem(SEEN_KEY, new Date().toISOString()); } catch { /* hidden for this session */ }
  }, []);
  return { show: !seen, dismiss };
}

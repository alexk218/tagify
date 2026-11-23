import "../features/onboarding/preview/installSandbox";

/** Spicetify's top-bar button for the Tagify custom app. */
export const TAGIFY_NAV_BUTTON = 'button[aria-label="Tagify"]';
const HOME = { pathname: "/", search: "", hash: "" };

type HistoryLocation = { pathname?: string; search?: string; hash?: string; state?: unknown };

export const isTagifyPath = (pathname: string | undefined) =>
  pathname === "/tagify" || Boolean(pathname?.startsWith("/tagify/"));

/**
 * Makes the Tagify button a toggle: while Tagify is open, clicking it again goes back to
 * the last page that wasn't Tagify (Home when there is none yet). Otherwise the button
 * keeps Spicetify's own behavior and opens Tagify.
 */
export function initializeTagifyNavToggle(): () => void {
  const history = Spicetify?.Platform?.History;
  if (!history || typeof history.listen !== "function") return () => {};

  let lastOutside: HistoryLocation | null = null;
  const remember = () => {
    const { pathname, search, hash, state } = (history.location ?? {}) as HistoryLocation;
    if (pathname && !isTagifyPath(pathname)) lastOutside = { pathname, search, hash, state };
  };
  remember();
  const unlisten = history.listen(remember);

  // Capture on the document runs before Spotify's React handlers, so its own
  // "open Tagify" never fires when we close it instead.
  const onClick = (event: MouseEvent) => {
    if (!(event.target instanceof Element) || !event.target.closest(TAGIFY_NAV_BUTTON)) return;
    if (!isTagifyPath((history.location as HistoryLocation | undefined)?.pathname)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    history.push(lastOutside ?? HOME);
  };
  document.addEventListener("click", onClick, true);

  return () => {
    document.removeEventListener("click", onClick, true);
    if (typeof unlisten === "function") unlisten();
  };
}

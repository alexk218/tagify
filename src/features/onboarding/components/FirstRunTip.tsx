import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Portal } from "@/components/ui";
import { isAnotherDialogOpen } from "@/utils/openDialogs";
import styles from "./FirstRunTip.module.css";
import type { CoreTipId } from "../firstRunTips";

const WIDTH = 300;
const EDGE = 12;
const GAP = 12;
/** How far in from the anchor's left edge the arrow points, for wide anchors such as the tag picker. */
const ARROW_INSET = 40;
const ARROW_SIZE = 12;
const WIDE = 240;
/** How long after the control turns up (and nothing else is in the way) the tip keeps bringing it into view while the page settles. */
const SCROLL_WINDOW_MS = 4000;
/** Time between those scrolls, so a smooth scroll can finish. */
const SCROLL_GAP_MS = 800;

export interface FirstRunTipProps {
  /** The control the tip points at: the element with this `data-tip` attribute. */
  anchor: string;
  title: string;
  body: string;
  /** Called once, the first time the tip is on screen. */
  onShown: () => void;
  /** "Got it", or Escape. */
  onGotIt: () => void;
  /** "Skip tips": no more tips on this device. */
  onSkip: () => void;
  /** Clicking the control itself, when that is the thing the tip asks for. */
  onAnchorClick?: () => void;
  /** Where the tip points, and what it says, while its own control isn't on screen. Clicking it isn't the thing the tip asks for. */
  fallback?: { anchor: string; title: string; body: string };
}

interface Placement { top: number; left: number; arrowLeft: number; side: "below" | "above" }

const findAnchor = (name: string) => document.querySelector<HTMLElement>(`[data-tip="${name}"]`);

/**
 * The part of the control that can be seen: its box cut to the window and to every scrolling area
 * around it, so a song row below the fold of the song list counts as off screen.
 */
function visibleBox(element: HTMLElement): { top: number; bottom: number } {
  const rect = element.getBoundingClientRect();
  let top = Math.max(rect.top, 0);
  let bottom = Math.min(rect.bottom, window.innerHeight);
  for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY;
    if (overflow === "visible" || overflow === "") continue;
    const clip = parent.getBoundingClientRect();
    top = Math.max(top, clip.top);
    bottom = Math.min(bottom, clip.bottom);
  }
  return { top, bottom };
}

/**
 * A small popover with an arrow pointing at a real control. It waits for the control to be on screen
 * and for no other dialog to be open, flips above the control when there isn't room below, and
 * follows it as the window resizes or scrolls. It never takes focus away from what the person is doing.
 */
export function FirstRunTip({ anchor: ownAnchor, title: ownTitle, body: ownBody, onShown, onGotIt, onSkip, onAnchorClick: ownAnchorClick, fallback }: FirstRunTipProps) {
  const fallbackAnchor = fallback?.anchor;
  const locate = useCallback(() => {
    const own = findAnchor(ownAnchor);
    if (own || !fallbackAnchor) return { element: own, onFallback: false };
    const other = findAnchor(fallbackAnchor);
    return { element: other, onFallback: Boolean(other) };
  }, [ownAnchor, fallbackAnchor]);
  // The Portal mounts its container after the first render, so the tip element arrives later; keep it in state.
  const [tipElement, setTipElement] = useState<HTMLElement | null>(null);
  const tipRef = useRef<HTMLElement | null>(null);
  const setTip = useCallback((element: HTMLElement | null) => {
    tipRef.current = element;
    setTipElement(element);
  }, []);
  const [located, setLocated] = useState(locate);
  const anchorElement = located.element;
  const onFallback = located.onFallback && fallback !== undefined;
  const anchor = onFallback ? fallback.anchor : ownAnchor;
  const title = onFallback ? fallback.title : ownTitle;
  const body = onFallback ? fallback.body : ownBody;
  const onAnchorClick = onFallback ? undefined : ownAnchorClick;
  const [blocked, setBlocked] = useState(true);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const shownRef = useRef(false);
  // Once the control has been on screen, the person decides where to scroll.
  const seenRef = useRef(false);
  const seenAnchorRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef({ until: 0, last: 0 });
  const titleId = `tagify-first-run-tip-${anchor}`;

  // The control may mount later (a song starts playing, the list loads), and another dialog may open on top.
  useEffect(() => {
    const check = () => {
      const found = locate();
      setLocated((current) => (current.element === found.element && current.onFallback === found.onFallback ? current : found));
      setBlocked(document.visibilityState !== "visible" || isAnotherDialogOpen(tipRef.current));
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("visibilitychange", check);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", check);
    };
  }, [locate]);

  const place = useCallback(() => {
    if (!anchorElement || !tipElement) return;
    const rect = anchorElement.getBoundingClientRect();
    if (rect.width === 0) {
      setPlacement(null);
      return;
    }
    // Off screen: bring the control into view (the tip is what the person is looking at next). The page
    // may still be laying out, so keep at it for a few seconds; after that, or once the control has been
    // seen, wait while the person scrolls elsewhere.
    const seen = visibleBox(anchorElement);
    if (seen.bottom - seen.top < Math.min(rect.height, 80) - 1) {
      setPlacement(null);
      const now = Date.now();
      const scroll = scrollRef.current;
      if (!seenRef.current && now < scroll.until && now - scroll.last >= SCROLL_GAP_MS) {
        scroll.last = now;
        anchorElement.scrollIntoView?.({ block: "center", behavior: "smooth" });
      }
      return;
    }
    seenRef.current = true;
    const width = Math.min(WIDTH, window.innerWidth - EDGE * 2);
    const height = tipElement.offsetHeight;
    // Point at the middle of a small control, near the start of a wide one such as the tag picker.
    const pointX = rect.left + (rect.width <= WIDE ? rect.width / 2 : ARROW_INSET);
    const left = Math.min(Math.max(EDGE, pointX - ARROW_INSET), window.innerWidth - width - EDGE);
    // Point at the part that can be seen, so a tall control half under the fold isn't pointed at below it.
    const roomBelow = window.innerHeight - seen.bottom - GAP - EDGE;
    const roomAbove = seen.top - GAP - EDGE;
    const side = roomBelow >= height || roomBelow >= roomAbove ? "below" : "above";
    const top = side === "below"
      ? Math.min(seen.bottom + GAP, window.innerHeight - height - EDGE)
      : Math.max(EDGE, seen.top - GAP - height);
    const arrowLeft = Math.min(Math.max(pointX - left - ARROW_SIZE / 2, 12), width - 24);
    setPlacement({ top, left, arrowLeft, side });
  }, [anchorElement, tipElement]);

  useLayoutEffect(() => {
    if (!anchorElement || blocked) return undefined;
    // A new control (the tag buttons loading after the fallback was shown) hasn't been seen yet.
    if (seenAnchorRef.current !== anchorElement) {
      seenAnchorRef.current = anchorElement;
      seenRef.current = false;
    }
    // The few seconds of scrolling start once nothing else is in the way.
    if (!seenRef.current) scrollRef.current = { until: Date.now() + SCROLL_WINDOW_MS, last: 0 };
    place();
    // Scroll events stop once a scroll ends, so check again while the page may still be settling.
    const settle = window.setInterval(() => { if (!seenRef.current && Date.now() < scrollRef.current.until + SCROLL_GAP_MS) place(); }, SCROLL_GAP_MS);
    const resize = new ResizeObserver(place);
    resize.observe(anchorElement);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.clearInterval(settle);
      resize.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorElement, blocked, place]);

  const visible = Boolean(anchorElement && !blocked && placement);

  useEffect(() => {
    if (!visible || shownRef.current) return;
    shownRef.current = true;
    onShown();
  }, [visible, onShown]);

  useEffect(() => {
    if (!visible) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      // Escape inside a field or menu belongs to that control.
      if (event.key !== "Escape" || event.defaultPrevented) return;
      onGotIt();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [visible, onGotIt]);

  useEffect(() => {
    if (!anchorElement || !onAnchorClick) return undefined;
    anchorElement.addEventListener("click", onAnchorClick);
    return () => anchorElement.removeEventListener("click", onAnchorClick);
  }, [anchorElement, onAnchorClick]);

  if (!anchorElement || blocked) return null;

  return (
    <Portal>
      <section
        ref={setTip}
        className={`${styles.tip} ${placement?.side === "above" ? styles.above : styles.below}`}
        role="dialog"
        aria-labelledby={titleId}
        style={placement
          ? { top: placement.top, left: placement.left, width: Math.min(WIDTH, window.innerWidth - EDGE * 2), "--tip-arrow-left": `${placement.arrowLeft}px` } as React.CSSProperties
          : { visibility: "hidden", top: 0, left: 0, width: WIDTH }}
      >
        <h2 id={titleId} className={styles.title}>{title}</h2>
        <p className={styles.body}>{body}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.skip} onClick={onSkip}>Skip tips</button>
          <button type="button" className={styles.gotIt} onClick={onGotIt}>Got it</button>
        </div>
      </section>
    </Portal>
  );
}

/**
 * What each tour tip says and which control it points at. Tagged by others names how many songs others
 * tagged when that is known.
 */
export function firstRunTipCopy(tip: CoreTipId, { othersFound = 0 }: { othersFound?: number } = {}): Pick<FirstRunTipProps, "anchor" | "title" | "body" | "fallback"> {
  switch (tip) {
    case "play":
      return { anchor: "play-song", title: "Play any song to start", body: "Play something in Spotify and tag it here." };
    case "tag": {
      const title = "Tag the song that's playing";
      const body = "Moods, genres, feelings, whatever you want. Then pick a few tags and get a playlist of exactly those songs.";
      // The first tag button; the tag picker's heading while every category is collapsed.
      return { anchor: "tag-button", title, body, fallback: { anchor: "tag-picker", title, body } };
    }
    case "rate":
      return { anchor: "rate", title: "Rate it here", body: "Stars for how much you like it, Energy for how intense it feels. You can filter by both later." };
    case "manage":
      return { anchor: "manage-tags", title: "Make the tags your own", body: "Add, rename or group them here." };
    case "tagged":
      return { anchor: "tagged-tab", title: "Your tagged songs", body: "Every song you tag shows up here. Click one to change its tags." };
    case "others":
      return {
        anchor: "others-tab",
        title: othersFound > 0 ? `People already tagged ${othersFound.toLocaleString()} of your songs` : "Songs other people tagged",
        body: "See what they called them and keep the tags you like.",
      };
  }
}

/** Scrolls an element to the top of the view, smoothly unless the member prefers reduced motion. */
export function revealElement(element: Element | null): void {
  if (!element) return;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView?.({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
}

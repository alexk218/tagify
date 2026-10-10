import { useLayoutEffect } from "react";
import { getRatingControlColor } from "@/utils/ratingControlTheme";

const CONTROL_COLOR_PROPERTY = "--tagify-rating-control-muted";

/** Keep the app and its portals readable when Marketplace changes a palette. */
export function useRatingControlTheme(): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previousValue = root.style.getPropertyValue(CONTROL_COLOR_PROPERTY);
    const previousPriority = root.style.getPropertyPriority(CONTROL_COLOR_PROPERTY);
    let frame: number | null = null;

    const update = () => {
      const probe = document.createElement("span");
      probe.hidden = true;
      probe.style.backgroundColor = "var(--spice-card)";
      document.body.appendChild(probe);
      const readColor = (property: string) => {
        probe.style.color = `var(${property})`;
        return getComputedStyle(probe).color;
      };
      const background = getComputedStyle(probe).backgroundColor;
      const color = getRatingControlColor(
        background,
        readColor("--spice-button-disabled"),
        readColor("--spice-subtext"),
        readColor("--spice-text"),
      );
      probe.remove();
      if (color) {
        if (root.style.getPropertyValue(CONTROL_COLOR_PROPERTY) !== color) {
          root.style.setProperty(CONTROL_COLOR_PROPERTY, color);
        }
      } else if (root.style.getPropertyValue(CONTROL_COLOR_PROPERTY)) {
        root.style.removeProperty(CONTROL_COLOR_PROPERTY);
      }
    };

    const scheduleUpdate = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        update();
      });
    };
    const observer = new MutationObserver(scheduleUpdate);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true, attributes: true });
    for (const element of [root, document.body]) {
      observer.observe(element, { attributes: true, attributeFilter: ["style", "class"] });
    }
    document.addEventListener("load", scheduleUpdate, true);
    window.addEventListener("focus", scheduleUpdate);
    update();

    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      document.removeEventListener("load", scheduleUpdate, true);
      window.removeEventListener("focus", scheduleUpdate);
      if (previousValue) root.style.setProperty(CONTROL_COLOR_PROPERTY, previousValue, previousPriority);
      else root.style.removeProperty(CONTROL_COLOR_PROPERTY);
    };
  }, []);
}

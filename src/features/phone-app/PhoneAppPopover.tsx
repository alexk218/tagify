import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Portal } from "@/components/ui";
// eslint-disable-next-line css-modules/no-unused-class -- shared between the panel and its popover
import styles from "./PhoneApp.module.css";

const WIDTH = 400;
const EDGE = 12;
const GAP = 8;

interface Placement { top: number; left: number; width: number; maxHeight: number }

/** A panel anchored under its top-menu button. Escape or a click elsewhere closes it. */
export function PhoneAppPopover({ anchor, onClose, children }: { anchor: HTMLElement | null; onClose: () => void; children: React.ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  useLayoutEffect(() => {
    if (!anchor) return undefined;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(WIDTH, window.innerWidth - EDGE * 2);
      const left = Math.min(Math.max(EDGE, rect.left), window.innerWidth - width - EDGE);
      const top = rect.bottom + GAP;
      setPlacement({ top, left, width, maxHeight: Math.max(160, window.innerHeight - top - EDGE) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
      anchor?.focus();
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && (panelRef.current?.contains(target) || anchor?.contains(target))) return;
      onClose();
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("mousedown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("mousedown", onPointerDown, true);
    };
  }, [anchor, onClose]);

  return (
    <Portal>
      <div
        ref={panelRef}
        className={styles.popover}
        role="dialog"
        aria-labelledby="tagify-phone-title"
        style={placement ? { top: placement.top, left: placement.left, width: placement.width, maxHeight: placement.maxHeight } : { visibility: "hidden" }}
      >
        {children}
      </div>
    </Portal>
  );
}

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Portal } from "@/components/ui";
import { InviteFriendsPanel, type InviteFriendsPanelProps } from "./InviteFriendsPanel";
import styles from "./InviteFriendsPopover.module.css";

const WIDTH = 380;
const EDGE = 12;
const GAP = 8;

interface Placement { top: number; left: number; width: number; maxHeight: number }

/** The invite panel, anchored under the action bar's Invite button. Escape or a click elsewhere closes it. */
export function InviteFriendsPopover({ anchor, onClose, onConnectCommunity, onOpenSync, ...panel }: Omit<InviteFriendsPanelProps, "entry"> & {
  anchor: HTMLElement | null;
  onClose: () => void;
}) {
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

  // Setup and the Sync dialog open over Tagify, so the panel steps aside first.
  const leaveFor = (next: () => void) => () => { onClose(); next(); };

  return (
    <Portal>
      <div
        ref={panelRef}
        className={styles.popover}
        role="dialog"
        aria-labelledby="tagify-invite-title"
        style={placement ? { top: placement.top, left: placement.left, width: placement.width, maxHeight: placement.maxHeight } : { visibility: "hidden" }}
      >
        <InviteFriendsPanel
          {...panel}
          entry="action_bar"
          onConnectCommunity={leaveFor(onConnectCommunity)}
          onOpenSync={leaveFor(onOpenSync)}
        />
      </div>
    </Portal>
  );
}

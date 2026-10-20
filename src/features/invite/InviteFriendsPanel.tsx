import React, { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { recordProductInteraction } from "@/features/product-analytics/productAnalytics";
import { copyText } from "@/utils/copyText";
import { resolveInviteLink, type InviteLink } from "./inviteLink";
import styles from "./InviteFriends.module.css";

/** Where the member opened the invite: the action bar button, or the power-user milestone. */
export type InviteEntry = "action_bar" | "milestone";

export interface InviteFriendsPanelProps {
  entry: InviteEntry;
  /** Opens Community setup, so the invite can carry the member's name. */
  onConnectCommunity: () => void;
  /** Opens the Sync dialog, where the member makes their tags public. */
  onOpenSync: () => void;
  /** Test seam; Tagify asks Community for the member's invite link. */
  resolveLink?: () => Promise<InviteLink>;
}

type CopyState = "idle" | "copied" | "failed";

/**
 * The full link, allowed to wrap only after a slash so a long handle moves whole onto its own line
 * instead of being cut off or split. A personal link dims what every invite shares, so the
 * member's handle stands out.
 */
function LinkText({ link }: { link: InviteLink }) {
  const parts = link.url.split(/(?<=\/)(?!\/)/);
  const last = parts.pop();
  const shared = parts.map((part, index) => <React.Fragment key={index}>{part}<wbr /></React.Fragment>);
  return (
    <>
      {link.kind === "personal" ? <span className={styles.linkShared}>{shared}</span> : shared}
      {last}
    </>
  );
}

export function InviteFriendsPanel({ entry, onConnectCommunity, onOpenSync, resolveLink = resolveInviteLink }: InviteFriendsPanelProps) {
  const [link, setLink] = useState<InviteLink | null>(null);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [previewHidden, setPreviewHidden] = useState(false);
  const fieldRef = useRef<HTMLDivElement>(null);
  const copyButtonRef = useRef<HTMLButtonElement>(null);
  const resetTimer = useRef<number | null>(null);

  useEffect(() => {
    let current = true;
    void resolveLink().then((next) => {
      if (!current) return;
      setLink(next);
      recordProductInteraction("invite_opened", { invite_entry: entry, invite_link: next.kind });
    });
    return () => { current = false; };
  }, [entry, resolveLink]);

  useEffect(() => { if (link) copyButtonRef.current?.focus(); }, [link]);
  useEffect(() => () => { if (resetTimer.current) window.clearTimeout(resetTimer.current); }, []);

  /** Selects the whole link, so it can be copied by hand. */
  const selectLink = () => {
    if (fieldRef.current && link) window.getSelection()?.selectAllChildren(fieldRef.current);
  };

  const copy = async () => {
    if (!link) return;
    try {
      await copyText(link.url);
      setCopyState("copied");
      recordProductInteraction("invite_link_copied", { invite_entry: entry, invite_link: link.kind });
      if (resetTimer.current) window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setCopyState("idle"), 2_500);
    } catch {
      setCopyState("failed");
      fieldRef.current?.focus();
      selectLink();
    }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.heading}>
        <h2 id="tagify-invite-title" className={styles.title}>Invite a friend</h2>
        <p className={styles.lede}>Send them your link. Tagify is free and works with Spotify on Mac, Windows and Linux.</p>
      </div>

      {link && !previewHidden ? (
        <figure className={styles.preview}>
          <img
            className={styles.previewImage}
            src={link.preview}
            alt={link.kind === "personal" ? "Your invite, with your name and your tags" : "You're invited to Tagify"}
            width={1200}
            height={630}
            onError={() => setPreviewHidden(true)}
          />
          <figcaption className={styles.previewCaption}>What they'll see</figcaption>
        </figure>
      ) : !link ? (
        <div className={styles.previewPlaceholder} aria-hidden="true" />
      ) : null}

      <div className={styles.linkRow}>
        <div
          ref={fieldRef}
          className={styles.linkField}
          role="textbox"
          aria-readonly="true"
          aria-label="Invite link"
          aria-disabled={!link || undefined}
          tabIndex={link ? 0 : -1}
          onFocus={selectLink}
        >
          {link ? <LinkText link={link} /> : "Getting your link…"}
        </div>
        <button
          ref={copyButtonRef}
          type="button"
          className={styles.copyButton}
          onClick={() => void copy()}
          disabled={!link}
        >
          {copyState === "copied" ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
          {copyState === "copied" ? "Copied" : "Copy link"}
        </button>
      </div>
      <span className={styles.visuallyHidden} role="status">{copyState === "copied" ? "Invite link copied" : ""}</span>
      {copyState === "failed" && (
        <p role="alert" className={styles.error}>Couldn't copy the link. Select it above and copy it yourself.</p>
      )}

      {link?.kind === "general" && link.nameStep && (
        <p className={styles.nameStep}>
          Want your name on the invite?{" "}
          <button
            type="button"
            className={styles.nameStepAction}
            onClick={link.nameStep === "connect" ? onConnectCommunity : onOpenSync}
          >
            {link.nameStep === "connect" ? "Connect Community" : "Make your tags public"}
          </button>
        </p>
      )}
    </div>
  );
}

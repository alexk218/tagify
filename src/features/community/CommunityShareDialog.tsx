import React, { useEffect, useMemo, useRef, useState } from "react";
import type { PublicationPolicyV2 } from "@tagify/sync-contracts";
import { ExternalLink, Globe, RefreshCw, X } from "lucide-react";
import { Portal } from "@/components/ui";
import { recordProductInteraction } from "@/features/product-analytics/productAnalytics";
import { syncRuntime } from "@/services/sync/SyncRuntime";
import type { TagTaxonomy, TrackData } from "@/types/tagData";
// eslint-disable-next-line css-modules/no-unused-class -- shared with the Cloud Sync and setup dialogs
import styles from "./CloudSyncModal.module.css";
import { COMMUNITY_PAGES_ORIGIN, openCommunityUrl } from "./communityLinks";
import {
  changePublication,
  hiddenBranchNames,
  isRevisionConflict,
  keepTagsPrivate,
  plural,
  PUBLISH_RATINGS_LINE,
  publicTagSummary,
  publishTags,
  savePublicationPolicy,
  type SharingSurface,
} from "./communityPublication";
import { CommunitySharingChoices, sameChoices, type SharingChoices } from "./CommunitySharingChoices";
import { communityErrorMessage } from "./communitySyncCopy";
import type { CommunitySharing } from "./useCommunitySharing";

/** `tasteLink`: a publish confirmation, which offers people who tag like the member. */
type Notice = { tone: "success" | "error"; text: string; tasteLink?: boolean };

const LEADS = {
  private: "You're keeping your tags private. Tagify keeps backing up your library.",
  paused: "Your profile shows your tags from before you paused. New changes stay private until you resume.",
  public: "Your tags are on your profile. Tags you hide stay private.",
} as const;

export function communityProfileUrl(handle: string | null): string {
  return handle ? `${COMMUNITY_PAGES_ORIGIN}/@${handle}` : COMMUNITY_PAGES_ORIGIN;
}

/** Community's Following page, which leads with people who tag like the member. */
export const COMMUNITY_FOLLOWING_URL = `${COMMUNITY_PAGES_ORIGIN}/feed`;

/**
 * What appears on the member's Community profile, with one step to publish.
 * Hiding tags is optional and starts folded away.
 */
export function CommunitySharePanel({ surface, sharing, tracks, taxonomy, waitingForLibrary = false, onSaved }: {
  surface: SharingSurface;
  sharing: CommunitySharing;
  tracks: Record<string, TrackData>;
  taxonomy: TagTaxonomy;
  /** True while the first library combine or upload still has to finish. */
  waitingForLibrary?: boolean;
  onSaved?: (policy: PublicationPolicyV2) => void;
}) {
  const { policy, state, phase } = sharing;
  // Hidden choices the member changed here but hasn't saved; null follows the saved choice.
  const [draft, setDraft] = useState<SharingChoices | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const opened = useRef(false);

  useEffect(() => {
    if (opened.current || !state) return;
    opened.current = true;
    recordProductInteraction("community_share_opened", { surface, sharing_state: state });
  }, [state, surface]);

  const choices = draft ?? policy;
  const unsaved = Boolean(draft && policy && !sameChoices(draft, policy));
  const summary = useMemo(() => choices ? publicTagSummary(tracks, taxonomy, choices) : null, [choices, tracks, taxonomy]);
  const hiddenNames = useMemo(() => choices ? hiddenBranchNames(taxonomy, choices) : [], [choices, taxonomy]);

  if (!policy || !state || !choices || !summary) {
    if (phase === "error") return <div className={styles.sharePanel}>
      <p>Couldn't check what's public.</p>
      <div className={styles.visibilityActions}><button type="button" className={styles.secondary} onClick={sharing.refresh}><RefreshCw size={15} /> Try again</button></div>
    </div>;
    return <div className={styles.sharePanel}><p>{phase === "idle" ? "Connect Tagify to Community to share your tags." : "Checking what's public…"}</p></div>;
  }

  const apply = async (change: (current: PublicationPolicyV2) => Promise<PublicationPolicyV2>, successText: string, failureText: string, tasteLink = false) => {
    setSaving(true);
    setNotice(null);
    try {
      const saved = await change({ ...policy, ...choices });
      setDraft(null);
      setNotice({ tone: "success", text: successText, tasteLink });
      onSaved?.(saved);
      void syncRuntime.syncNow();
    } catch (error) {
      if (isRevisionConflict(error)) {
        // Keep the member's unsaved choices; they apply on top of the newer saved ones.
        sharing.refresh();
        setNotice({ tone: "error", text: "Your sharing settings changed on Community. Check your choices, then try again." });
      } else {
        setNotice({ tone: "error", text: communityErrorMessage(error, failureText) });
      }
    } finally {
      setSaving(false);
    }
  };

  const publish = () => apply((current) => publishTags(current, surface), "Publishing your tags. Your profile updates within a minute.", "Your tags couldn't be published. Please try again.", true);
  const saveChoices = () => apply((current) => savePublicationPolicy(current), "Saved. Your profile updates within a minute.", "Couldn't save your choices. Please try again.");
  const keepPrivate = () => apply(keepTagsPrivate, "Your tags stay private. You can publish them from Community in Tagify any time.", "Couldn't save your choice. Please try again.");
  const resume = () => apply((current) => changePublication(current, "resume"), "Updates resumed. Your profile catches up within a minute.", "Couldn't resume updates. Please try again.");

  const notPublicYet = state === "review" || state === "private";
  const busy = saving || waitingForLibrary;

  return <div className={styles.sharePanel}>
    {state === "review" ? null : <p>{LEADS[state]}</p>}
    {notPublicYet ? <p className={styles.shareLead}>{summary.songs > 0
      ? <><strong>{plural(summary.tags, "tag")}</strong> on <strong>{plural(summary.songs, "song")}</strong> would appear on your profile.</>
      : "None of your songs have tags to share yet. Songs you tag later will appear."}</p> : null}
    {notPublicYet ? <p>{PUBLISH_RATINGS_LINE}</p> : null}
    {hiddenNames.length ? <p>{hiddenLine(hiddenNames)}</p> : null}
    {waitingForLibrary ? <p className={styles.warningText}>Choose how to combine this computer's library with Community in Sync before sharing.</p> : null}

    <button type="button" className={styles.disclosureLink} aria-expanded={choosing} aria-controls="community-sharing-choices" onClick={() => setChoosing((current) => !current)}>
      Choose what's hidden
    </button>
    {choosing ? <div id="community-sharing-choices">
      <CommunitySharingChoices taxonomy={taxonomy} choices={choices} published={state === "public" || state === "paused"} disabled={saving} onChange={setDraft} />
    </div> : null}

    {/* Alex, 2026-11-16: "Let's remove the stop sharing button there. They could do that elsewhere." Stop sharing lives on Community (profile and Settings > Privacy). */}
    <div className={styles.visibilityActions}>
      {notPublicYet ? <button type="button" className={styles.primary} onClick={() => void publish()} disabled={busy}>{saving ? "Publishing…" : "Publish my tags"}</button> : null}
      {state === "review" ? <button type="button" className={styles.quietAction} onClick={() => void keepPrivate()} disabled={busy}>Keep my tags private</button> : null}
      {state === "private" && unsaved ? <button type="button" className={styles.secondary} onClick={() => void saveChoices()} disabled={busy}>Save without publishing</button> : null}
      {state === "paused" ? <button type="button" className={styles.primary} onClick={() => void resume()} disabled={busy}>{saving ? "Resuming…" : "Resume updates"}</button> : null}
      {(state === "public" || state === "paused") && unsaved ? <button type="button" className={state === "public" ? styles.primary : styles.secondary} onClick={() => void saveChoices()} disabled={busy}>{saving && state === "public" ? "Saving…" : "Save changes"}</button> : null}
      {(state === "public" || state === "paused") && !unsaved ? <button type="button" className={styles.secondary} onClick={() => openCommunityUrl(communityProfileUrl(sharing.handle))}><ExternalLink size={15} /> View my profile</button> : null}
    </div>
    {notice ? <div className={notice.tone === "success" ? styles.success : styles.error} role="status">
      {notice.text}
      {/* Alex, 2026-10-30: "Link to Following (Recommended)", on the website and in the desktop app. */}
      {notice.tasteLink ? <button type="button" className={styles.noticeLink} onClick={() => openCommunityUrl(COMMUNITY_FOLLOWING_URL)}>
        See people who tag like you <ExternalLink size={13} aria-hidden="true" />
      </button> : null}
    </div> : null}
  </div>;
}

/** "Workout, Guilty pleasures and 2 more stay private." */
export function hiddenLine(names: string[]): string {
  const shown = names.slice(0, 3);
  const more = names.length - shown.length;
  const list = more > 0 ? `${shown.join(", ")} and ${more.toLocaleString()} more`
    : shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`
    : shown[0];
  return `${list} ${names.length === 1 ? "stays" : "stay"} private.`;
}

export function CommunityShareDialog({ surface, sharing, tracks, taxonomy, waitingForLibrary, onClose }: {
  surface: SharingSurface;
  sharing: CommunitySharing;
  tracks: Record<string, TrackData>;
  taxonomy: TagTaxonomy;
  waitingForLibrary?: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return <Portal><div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="community-share-title">
    <section className={styles.modal}>
      <header>
        <div><p>Community</p><h2 id="community-share-title"><Globe size={20} /> Share your tags</h2></div>
        <button type="button" aria-label="Close sharing" onClick={onClose}><X /></button>
      </header>
      <div className={styles.body}>
        <CommunitySharePanel surface={surface} sharing={sharing} tracks={tracks} taxonomy={taxonomy} waitingForLibrary={waitingForLibrary} />
      </div>
    </section>
  </div></Portal>;
}

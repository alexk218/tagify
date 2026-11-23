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
  publicTagSummary,
  publishTags,
  savePublicationPolicy,
  type SharingSurface,
} from "./communityPublication";
import { saveRatingSharing } from "./communityRatingSharing";
import { CommunitySharingChoices, sameChoices, type SharingChoices } from "./CommunitySharingChoices";
import { ALL_HIDDEN_LINE, communityErrorMessage, KEEP_PRIVATE_CONSEQUENCE, PRIVATE_LOCKS_LINE } from "./communitySyncCopy";
import { claimCommunityHandle, handleProblem, HandleClaimError, normalizeHandle } from "./communityDevice";
import type { CommunitySharing } from "./useCommunitySharing";
import { openCommunityUrlSignedIn } from "./communityWebsiteLink";

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
  // null follows the default: folded, except while every tag is hidden.
  const [choosingChoice, setChoosing] = useState<boolean | null>(null);
  // Asks once before every tag stays private, with what that locks (Alex's pick C, 2026-11-23): "keep"
  // keeps tags private, "save" saves hidden choices that hide every tag (which counts as private too).
  const [confirmingPrivate, setConfirmingPrivate] = useState<"keep" | "save" | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  // A member who connected before picking a handle picks it here, to publish (in-app sign-up, slice 2).
  const [handleDraft, setHandleDraft] = useState("");
  const [handleError, setHandleError] = useState("");
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
  // Hiding every tag on a tagged library counts as keeping tags private (Alex, 2026-11-23).
  const anyTagged = useMemo(() => publicTagSummary(tracks, taxonomy).songs > 0, [tracks, taxonomy]);

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

  const publish = async () => {
    if (sharing.handleMissing) {
      const handle = normalizeHandle(handleDraft);
      const problem = handleProblem(handle);
      if (problem) { setHandleError(problem); return; }
      setSaving(true);
      setHandleError("");
      try {
        await claimCommunityHandle(handle);
      } catch (error) {
        setSaving(false);
        setHandleError(error instanceof HandleClaimError ? error.message : "Your handle couldn't be saved. Try again.");
        return;
      }
    }
    await apply(async (current) => {
      // Publishing shares the star ratings on the published songs too; no separate choice (Alex, 2026-11-22).
      const saved = await publishTags(current, surface);
      // Records the answer so the question after rating never asks again.
      if (notPublicYet) void saveRatingSharing(true, "desktop_publish").catch(() => undefined);
      return saved;
    }, "Publishing your tags. Your profile updates within a minute.", "Your tags couldn't be published. Please try again.", true);
  };
  const saveChoices = () => apply((current) => savePublicationPolicy(current), "Saved. Your profile updates within a minute.", "Couldn't save your choices. Please try again.");
  const keepPrivate = () => apply(keepTagsPrivate, "Your tags stay private. You can publish them from Community in Tagify any time.", "Couldn't save your choice. Please try again.");
  const resume = () => apply((current) => changePublication(current, "resume"), "Updates resumed. Your profile catches up within a minute.", "Couldn't resume updates. Please try again.");

  const notPublicYet = state === "review" || state === "private";
  const allHidden = anyTagged && summary.songs === 0;
  const choosing = choosingChoice ?? allHidden;
  const busy = saving || waitingForLibrary;
  const pickingHandle = notPublicYet && sharing.handleMissing;
  const typedHandle = normalizeHandle(handleDraft);

  return <div className={styles.sharePanel}>
    {state === "review" || (allHidden && state === "public") ? null : <p>{LEADS[state]}</p>}
    {allHidden ? <p className={styles.warningText} role="status">{ALL_HIDDEN_LINE}</p>
      : notPublicYet ? <p className={styles.shareLead}>{summary.songs > 0
        ? <><strong>{plural(summary.tags, "tag")}</strong> on <strong>{plural(summary.songs, "song")}</strong> would appear on your profile.</>
        : "None of your songs have tags to share yet. Songs you tag later will appear."}</p> : null}
    {notPublicYet ? <p>
      Something personal in there?{" "}
      <button type="button" className={styles.inlineLink} aria-expanded={choosing} aria-controls="community-sharing-choices" onClick={() => setChoosing(!choosing)}>Hide any tag or folder</button>
      , and the rest goes on your profile. Private notes always stay private.
    </p> : null}
    {hiddenNames.length && !allHidden ? <p>{hiddenLine(hiddenNames)}</p> : null}
    {pickingHandle ? <div className={styles.handleField}>
      <label htmlFor="community-handle">Your handle</label>
      <div className={styles.handleInput}>
        <span aria-hidden="true">@</span>
        <input id="community-handle" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={31}
          placeholder="yourname" value={handleDraft} disabled={saving} aria-describedby="community-handle-hint" aria-invalid={Boolean(handleError)}
          onChange={(event) => { setHandleDraft(event.target.value.replace(/\s/g, "")); setHandleError(""); }} />
      </div>
      <small id="community-handle-hint">Your profile will be at tagify.fm/@{typedHandle || "yourname"}. You can&apos;t change it later.</small>
      {handleError ? <p className={styles.errorText} role="alert">{handleError}</p> : null}
    </div> : null}
    {waitingForLibrary ? <p className={styles.warningText}>Choose how to combine this computer's library with Community in Sync before sharing.</p> : null}

    {notPublicYet ? null : <button type="button" className={styles.disclosureLink} aria-expanded={choosing} aria-controls="community-sharing-choices" onClick={() => setChoosing(!choosing)}>
      Choose what's hidden
    </button>}
    {choosing ? <div id="community-sharing-choices">
      <CommunitySharingChoices taxonomy={taxonomy} choices={choices} published={state === "public" || state === "paused"} disabled={saving} onChange={setDraft} />
    </div> : null}

    {/* Alex, 2026-11-16: "Let's remove the stop sharing button there. They could do that elsewhere." Stop sharing lives on Community (profile and Settings > Privacy). */}
    {confirmingPrivate ? <div className={styles.privateConfirm} role="group" aria-labelledby="community-keep-private-title" aria-describedby="community-keep-private-consequence">
      <p id="community-keep-private-title"><strong>Keep all your tags private?</strong></p>
      <p id="community-keep-private-consequence">{KEEP_PRIVATE_CONSEQUENCE}</p>
      <div className={styles.visibilityActions}>
        <button type="button" className={styles.secondary} onClick={() => { setConfirmingPrivate(null); setChoosing(true); }} disabled={busy}>{allHidden ? "Show some tags" : "Hide some instead"}</button>
        <button type="button" className={styles.quietAction} onClick={() => {
          const confirmed = confirmingPrivate;
          setConfirmingPrivate(null);
          void (confirmed === "save" ? saveChoices() : keepPrivate());
        }} disabled={busy}>Keep everything private</button>
      </div>
    </div> : <div className={styles.visibilityActions}>
      {/* Publishing with every tag hidden would publish nothing, so it asks the keep-private question instead. */}
      {notPublicYet ? <button type="button" className={styles.primary} onClick={() => allHidden ? setConfirmingPrivate("keep") : void publish()} disabled={busy}>{saving ? "Publishing…" : "Publish my tags"}</button> : null}
      {state === "private" && unsaved ? <button type="button" className={styles.secondary} onClick={() => void saveChoices()} disabled={busy}>Save without publishing</button> : null}
      {state === "paused" ? <button type="button" className={styles.primary} onClick={() => void resume()} disabled={busy}>{saving ? "Resuming…" : "Resume updates"}</button> : null}
      {(state === "public" || state === "paused") && unsaved ? <button type="button" className={state === "public" ? styles.primary : styles.secondary} onClick={() => allHidden ? setConfirmingPrivate("save") : void saveChoices()} disabled={busy}>{saving && state === "public" ? "Saving…" : "Save changes"}</button> : null}
      {(state === "public" || state === "paused") && !unsaved ? <button type="button" className={styles.secondary} onClick={() => void openCommunityUrlSignedIn(communityProfileUrl(sharing.handle))}><ExternalLink size={15} /> View my profile</button> : null}
    </div>}
    {state === "review" && !confirmingPrivate ? <p className={styles.legalLine}>
      {PRIVATE_LOCKS_LINE}{" "}
      <button type="button" className={styles.inlineLink} onClick={() => setConfirmingPrivate("keep")} disabled={busy}>Keep my tags private</button>
    </p> : null}
    {pickingHandle ? <p className={styles.legalLine}>
      By publishing, you confirm you&apos;re 16 or older and agree to the{" "}
      <button type="button" className={styles.inlineLink} onClick={() => openCommunityUrl(`${COMMUNITY_PAGES_ORIGIN}/terms`)}>Terms</button> and{" "}
      <button type="button" className={styles.inlineLink} onClick={() => openCommunityUrl(`${COMMUNITY_PAGES_ORIGIN}/privacy`)}>Privacy Policy</button>.
    </p> : null}
    {notice ? <div className={notice.tone === "success" ? styles.success : styles.error} role="status">
      {notice.text}
      {/* Alex, 2026-10-30: "Link to Following (Recommended)", on the website and in the desktop app. */}
      {notice.tasteLink ? <button type="button" className={styles.noticeLink} onClick={() => void openCommunityUrlSignedIn(COMMUNITY_FOLLOWING_URL)}>
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

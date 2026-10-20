import React, { useEffect, useRef, useState } from "react";
import type { PublicationPolicyV2 } from "@tagify/sync-contracts";
import { Globe } from "lucide-react";
import type { UserTrackAddedEvent } from "@/features/tag-data";
import { getUsageAccountDigest } from "@/features/discovery-survey/services/tagifyUsage";
import { recordProductInteraction } from "@/features/product-analytics/productAnalytics";
import type { SyncStatus } from "@/services/sync/SyncRuntime";
import type { TagTaxonomy, TrackData } from "@/types/tagData";
import { isAnotherDialogOpen } from "@/utils/openDialogs";
import {
  fetchPublicationPolicy,
  keepTagsPrivate,
  plural,
  publicationState,
  publicTagSummary,
  sharesRatings,
} from "./communityPublication";
import {
  canAskToPublish,
  markCommunityPublishPromptDecidedFor,
  readCommunityPublishPromptHistory,
  recordCommunityPublishPromptAsk,
} from "./communityPublishPromptHistory";
import { communityErrorMessage } from "./communitySyncCopy";
import styles from "./CommunityConnectPrompt.module.css";

/** Delay after other dialogs close, so the invitation never flashes between two of them. */
const SETTLE_MS = 1000;
/** Enough tagged songs that a public profile would show something worth sharing. */
export const PUBLISH_PROMPT_MIN_TAGGED_SONGS = 5;
/** States where Tagify has something more urgent to say about Sync, or can't reach Community. */
const SYNC_NEEDS_ATTENTION = new Set<SyncStatus>(["unlinked", "offline", "reauthorize", "snapshot-required", "merge-required", "recovery-available", "restoring", "restore-failed"]);

interface CommunityPublishPromptProps {
  /** False while Tagify is loading or showing anything that should take priority. */
  enabled: boolean;
  connected: boolean;
  status: SyncStatus;
  taggedTrackCount: number;
  lastUserTrackAddedEvent: UserTrackAddedEvent | null;
  tracks: Record<string, TrackData>;
  taxonomy: TagTaxonomy;
  onReview: () => void;
}

interface Invitation {
  policy: PublicationPolicyV2;
  tags: number;
  songs: number;
}

/**
 * Invites a connected member who never chose what to share to publish, right
 * after they tag a song. It asks twice at most, and an explicit answer ends it.
 */
export function CommunityPublishPrompt({ enabled, connected, status, taggedTrackCount, lastUserTrackAddedEvent, tracks, taxonomy, onReview }: CommunityPublishPromptProps) {
  const [accountDigest, setAccountDigest] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  // Answered or skipped for this session: never shown again until Tagify reloads.
  const [handled, setHandled] = useState(false);
  const [visible, setVisible] = useState(false);
  const [confirmingPrivate, setConfirmingPrivate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const lastHandledEventId = useRef<number | null>(null);
  const askRecorded = useRef(false);
  // The sharing choice is checked at most once per session; a failed check retries after the next song.
  const checking = useRef(false);
  const checked = useRef(false);
  const mounted = useRef(true);
  // Read at answer time, so a library update during the check doesn't cancel it.
  const library = useRef({ tracks, taxonomy });
  library.current = { tracks, taxonomy };

  useEffect(() => {
    mounted.current = true;
    void getUsageAccountDigest().then((digest) => { if (mounted.current) setAccountDigest(digest); });
    return () => { mounted.current = false; };
  }, []);

  const syncReady = connected && !SYNC_NEEDS_ATTENTION.has(status);

  // Check only after the member tags a new song, so the invitation follows their own action.
  useEffect(() => {
    // Until the account is known, keep the latest song pending rather than skipping it.
    if (!lastUserTrackAddedEvent || !accountDigest || lastHandledEventId.current === lastUserTrackAddedEvent.eventId) return;
    lastHandledEventId.current = lastUserTrackAddedEvent.eventId;
    if (handled || checked.current || checking.current || !syncReady || taggedTrackCount < PUBLISH_PROMPT_MIN_TAGGED_SONGS) return;
    if (!canAskToPublish(readCommunityPublishPromptHistory(accountDigest))) return;

    checking.current = true;
    // The saved sharing choice, not the last sync's status, decides: status only settles after a sync.
    void fetchPublicationPolicy().then((policy) => {
      checked.current = true;
      if (!mounted.current) return;
      if (publicationState(policy) !== "review") {
        markCommunityPublishPromptDecidedFor(accountDigest);
        return;
      }
      const summary = publicTagSummary(library.current.tracks, library.current.taxonomy, policy);
      if (summary.songs > 0) setInvitation({ policy, ...summary });
    }).catch(() => { /* Try again after the next tagged song. */ })
      .finally(() => { checking.current = false; });
  }, [accountDigest, syncReady, handled, lastUserTrackAddedEvent, taggedTrackCount]);

  const eligible = enabled && syncReady && Boolean(invitation) && !handled;

  useEffect(() => {
    if (!eligible) {
      setVisible(false);
      return;
    }
    if (visible) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const tryShowing = () => {
      if (document.visibilityState !== "visible" || isAnotherDialogOpen()) {
        clearTimeout(timer);
        timer = undefined;
        return;
      }
      if (!timer) timer = setTimeout(() => setVisible(true), SETTLE_MS);
    };
    const observer = new MutationObserver(tryShowing);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("visibilitychange", tryShowing);
    tryShowing();
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      document.removeEventListener("visibilitychange", tryShowing);
    };
  }, [eligible, visible]);

  // Count an ask only once the member can actually see it: Tagify may be scrolled down to the tags.
  const promptRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const element = promptRef.current;
    if (!visible || askRecorded.current || !accountDigest || !element) return;
    const recordAsk = () => {
      if (askRecorded.current) return;
      askRecorded.current = true;
      const history = recordCommunityPublishPromptAsk(accountDigest);
      recordProductInteraction(history.asks > 1 ? "community_publish_prompt_reminder_shown" : "community_publish_prompt_shown");
    };
    if (typeof IntersectionObserver === "undefined") {
      recordAsk();
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        recordAsk();
        observer.disconnect();
      }
    }, { threshold: 0.6 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [accountDigest, visible]);

  if (!eligible || !visible || !invitation) return null;

  const review = () => {
    setHandled(true);
    onReview();
  };

  const notNow = () => {
    recordProductInteraction("community_publish_prompt_snoozed");
    setHandled(true);
  };

  const keepPrivate = async () => {
    setSaving(true);
    setError("");
    try {
      await keepTagsPrivate(invitation.policy);
      if (accountDigest) markCommunityPublishPromptDecidedFor(accountDigest);
      setHandled(true);
    } catch (nextError) {
      setError(communityErrorMessage(nextError, "Couldn't save your choice. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  if (confirmingPrivate) {
    return (
      <section ref={promptRef} className={`${styles.prompt} ${styles.promptLong}`} aria-labelledby="community-publish-prompt-title" aria-describedby="community-publish-prompt-description">
        <span className={styles.icon} aria-hidden="true"><Globe size={18} /></span>
        <div className={styles.text}>
          <h2 id="community-publish-prompt-title" className={styles.title}>Keep your tags private?</h2>
          <p id="community-publish-prompt-description" className={styles.description}>
            Tagify keeps backing up your library and won't ask again. You can publish any time from Community in Tagify.
          </p>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={() => { setConfirmingPrivate(false); setError(""); }} disabled={saving}>Cancel</button>
          <button type="button" className={styles.primary} onClick={() => void keepPrivate()} disabled={saving}>{saving ? "Saving…" : "Keep private"}</button>
        </div>
      </section>
    );
  }

  return (
    <section ref={promptRef} className={`${styles.prompt} ${styles.promptLong}`} aria-labelledby="community-publish-prompt-title" aria-describedby="community-publish-prompt-description">
      <span className={styles.icon} aria-hidden="true"><Globe size={18} /></span>
      <div className={styles.text}>
        <h2 id="community-publish-prompt-title" className={styles.title}>Your tags aren't public yet</h2>
        <p id="community-publish-prompt-description" className={styles.description}>
          Tagify is backing up your library, but your Community profile stays empty until you choose what to share.
          {" "}{plural(invitation.tags, "tag")} on {plural(invitation.songs, "song")} would appear.
          {" "}{sharesRatings(invitation.policy) ? "Private notes stay private, and your ratings would show too." : "Private notes and ratings stay private."}
          {" "}You can hide any tag or folder first.
        </p>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.quiet} onClick={() => setConfirmingPrivate(true)}>Keep my tags private</button>
        <button type="button" className={styles.secondary} onClick={notNow}>Not now</button>
        <button type="button" className={styles.primary} onClick={review}>Review and publish</button>
      </div>
    </section>
  );
}

import React, { useEffect, useRef, useState } from "react";
import { Star } from "lucide-react";
import { getUsageAccountDigest, RATING_COMPLETED_EVENT } from "@/features/discovery-survey/services/tagifyUsage";
import type { SyncStatus } from "@/services/sync/SyncRuntime";
import { isAnotherDialogOpen } from "@/utils/openDialogs";
import { openCommunityUrl } from "./communityLinks";
import {
  canOfferRatingSharing,
  COMMUNITY_PRIVACY_SETTINGS_URL,
  COMMUNITY_RATING_SHARING_CHANGED_EVENT,
  fetchRatingSharing,
  markRatingSharingAnsweredFor,
  markRatingSharingAskedFor,
  RATING_SHARING_COPY,
  ratingSharingErrorMessage,
  readRatingSharingAnswered,
  readRatingSharingAsked,
  recordRatingSharingAsked,
  saveRatingSharing,
  shouldAskRatingSharing,
  type RatingSharing,
} from "./communityRatingSharing";
// eslint-disable-next-line css-modules/no-unused-class -- shared with the Community invitations
import styles from "./CommunityConnectPrompt.module.css";

/** Delay after other dialogs close, so the question never flashes between two of them. */
const SETTLE_MS = 1000;
/** States where Tagify has something more urgent to say about Sync, or can't reach Community. */
const SYNC_NEEDS_ATTENTION = new Set<SyncStatus>(["unlinked", "offline", "reauthorize", "snapshot-required", "merge-required", "recovery-available", "restoring", "restore-failed"]);

// Shown at most once per Tagify run, even if the page closes and opens again.
let shownThisRun = false;

/** Lets tests start a fresh Tagify run. */
export function resetRatingSharingQuestionRun(): void {
  shownThisRun = false;
}

/**
 * Asks a member who already shares their tags, at most once per computer
 * (answered or not), whether their star
 * ratings should show too: after their next rating or when Tagify opens,
 * whichever comes first. The answer is kept on Community, so the website and
 * other computers don't ask again. It only asks members with a public profile,
 * so it never appears beside the publish invitation, which is for members who
 * haven't published.
 */
export function CommunityRatingSharingQuestion({ enabled, connected, status }: {
  /** False while Tagify is loading or showing anything that should take priority. */
  enabled: boolean;
  connected: boolean;
  status: SyncStatus;
}) {
  const [accountDigest, setAccountDigest] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState<"shared" | "kept" | null>(null);
  const [closed, setClosed] = useState(false);
  const mounted = useRef(true);
  const checking = useRef(false);
  const openChecked = useRef(false);
  const ratingChecked = useRef(false);
  const askRecorded = useRef(false);
  const promptRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    mounted.current = true;
    void getUsageAccountDigest().then((digest) => { if (mounted.current) setAccountDigest(digest); });
    return () => { mounted.current = false; };
  }, []);

  const syncReady = connected && !SYNC_NEEDS_ATTENTION.has(status);
  const latest = useRef({ accountDigest, syncReady, asking });
  latest.current = { accountDigest, syncReady, asking };

  const check = (afterRating: boolean) => {
    const digest = latest.current.accountDigest;
    if (!digest || checking.current || shownThisRun || readRatingSharingAsked(digest) || readRatingSharingAnswered(digest)) return;
    checking.current = true;
    void fetchRatingSharing().then((sharing: RatingSharing | null) => {
      if (!mounted.current) return;
      if (sharing?.answered) markRatingSharingAnsweredFor(digest);
      // A rating made just now may not have reached Community yet, so the rating itself is enough.
      const ask = shouldAskRatingSharing(sharing, readRatingSharingAnswered(digest))
        || (afterRating && canOfferRatingSharing(sharing) && !readRatingSharingAnswered(digest));
      if (ask) setAsking(true);
    }).finally(() => { checking.current = false; });
  };

  // When Tagify opens.
  useEffect(() => {
    if (!accountDigest || !syncReady || openChecked.current) return;
    openChecked.current = true;
    check(false);
  }, [accountDigest, syncReady]);

  // After the member's next rating, if opening didn't ask.
  useEffect(() => {
    const onRating = () => {
      if (ratingChecked.current || latest.current.asking || !latest.current.syncReady) return;
      ratingChecked.current = true;
      check(true);
    };
    window.addEventListener(RATING_COMPLETED_EVENT, onRating);
    return () => window.removeEventListener(RATING_COMPLETED_EVENT, onRating);
  }, []);

  // Answered elsewhere in Tagify (an update notice or publishing): this question goes away.
  useEffect(() => {
    const onChanged = (event: Event) => {
      const saved = (event as CustomEvent<{ ratingSharing?: RatingSharing }>).detail?.ratingSharing;
      if (saved?.answered && !answer) setAsking(false);
    };
    window.addEventListener(COMMUNITY_RATING_SHARING_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(COMMUNITY_RATING_SHARING_CHANGED_EVENT, onChanged);
  }, [answer]);

  const eligible = enabled && syncReady && asking && !closed;

  useEffect(() => {
    if (!eligible) {
      if (!answer) setVisible(false);
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
  }, [eligible, visible, answer]);

  // Once shown, it never returns on this computer, even if ignored.
  useEffect(() => {
    if (!visible) return;
    shownThisRun = true;
    if (accountDigest) markRatingSharingAskedFor(accountDigest);
  }, [visible, accountDigest]);

  // Count the question once the member can actually see it: Tagify may be scrolled down.
  useEffect(() => {
    const element = promptRef.current;
    if (!visible || answer || askRecorded.current || !element) return;
    const recordAsk = () => {
      if (askRecorded.current) return;
      askRecorded.current = true;
      recordRatingSharingAsked("desktop_question");
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
  }, [visible, answer]);

  if (closed || !visible || (!eligible && !answer)) return null;

  const choose = async (share: boolean) => {
    setSaving(true);
    setError("");
    try {
      await saveRatingSharing(share, "desktop_question");
      if (!mounted.current) return;
      setAnswer(share ? "shared" : "kept");
    } catch (nextError) {
      if (mounted.current) setError(ratingSharingErrorMessage(nextError));
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  if (answer) {
    return (
      <section ref={promptRef} className={`${styles.prompt} ${styles.promptLong}`} role="status" aria-labelledby="community-rating-sharing-title" aria-describedby="community-rating-sharing-description">
        <span className={styles.icon} aria-hidden="true"><Star size={18} /></span>
        <div className={styles.text}>
          <h2 id="community-rating-sharing-title" className={styles.title}>{answer === "shared" ? RATING_SHARING_COPY.shared : RATING_SHARING_COPY.keptPrivate}</h2>
          <p id="community-rating-sharing-description" className={styles.description}>
            {RATING_SHARING_COPY.changeLaterLead}{" "}
            <button type="button" className={styles.inlineLink} onClick={() => openCommunityUrl(COMMUNITY_PRIVACY_SETTINGS_URL)}>{RATING_SHARING_COPY.privacySettings}</button>.
          </p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={() => setClosed(true)}>Got it</button>
        </div>
      </section>
    );
  }

  return (
    <section ref={promptRef} className={`${styles.prompt} ${styles.promptLong}`} aria-labelledby="community-rating-sharing-title" aria-describedby="community-rating-sharing-description">
      <span className={styles.icon} aria-hidden="true"><Star size={18} /></span>
      <div className={styles.text}>
        <h2 id="community-rating-sharing-title" className={styles.title}>{RATING_SHARING_COPY.question}</h2>
        <p id="community-rating-sharing-description" className={styles.description}>{RATING_SHARING_COPY.explanation}</p>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={() => void choose(false)} disabled={saving}>{RATING_SHARING_COPY.keepPrivate}</button>
        <button type="button" className={styles.primary} onClick={() => void choose(true)} disabled={saving}>{saving ? "Saving…" : RATING_SHARING_COPY.share}</button>
      </div>
    </section>
  );
}

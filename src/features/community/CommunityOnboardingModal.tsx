import React, { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Cloud, ExternalLink, Link2, RefreshCw, ShieldAlert, ShieldCheck, UserCircle2, X } from "lucide-react";
import { fetchCommunityProfile } from "./communityDevice";
import { COMMUNITY_ORIGIN, openCommunityUrl } from "./communityLinks";
import { CommunityVisibilityReview } from "./CommunityPublicVisibilityReview";
import { getDesktopSyncConfiguration, setDesktopSyncConfiguration, type DesktopSyncConfiguration } from "@/services/sync/SyncLocalState";
import { syncPairingService, type ApprovedPairing } from "@/services/sync/SyncPairingService";
import { syncRuntime } from "@/services/sync/SyncRuntime";
import { Portal } from "@/components/ui";
import styles from "./CloudSyncModal.module.css";
import { InitialLibraryMergeReview } from "./InitialLibraryMergeReview";
import { communityErrorMessage, communitySyncStatusLabel } from "./communitySyncCopy";

export const COMMUNITY_ONBOARDING_STORAGE_KEY = "tagify:community:onboarding:v1";
const COMMUNITY_ONBOARDING_SESSION_SNOOZE_KEY = "tagify:community:onboarding:snoozed-session";
const COMMUNITY_ONBOARDING_COMPLETED = "completed";
const COMMUNITY_ONBOARDING_DECLINED = "declined";

export function shouldShowCommunityOnboarding(): boolean {
  try {
    if (!needsCommunityOnboardingSetup()) return false;
    const status = localStorage.getItem(COMMUNITY_ONBOARDING_STORAGE_KEY);
    if (status === COMMUNITY_ONBOARDING_COMPLETED || status === COMMUNITY_ONBOARDING_DECLINED) return false;
    return sessionStorage.getItem(COMMUNITY_ONBOARDING_SESSION_SNOOZE_KEY) !== "1";
  } catch {
    return false;
  }
}

export function needsCommunityOnboardingSetup(): boolean {
  try { return !getDesktopSyncConfiguration(); } catch { return false; }
}

export function snoozeCommunityOnboarding(): void {
  try { sessionStorage.setItem(COMMUNITY_ONBOARDING_SESSION_SNOOZE_KEY, "1"); } catch { /* Storage may be unavailable in Spotify's browser shell. */ }
}

export function declineCommunityOnboarding(): void {
  try { localStorage.setItem(COMMUNITY_ONBOARDING_STORAGE_KEY, COMMUNITY_ONBOARDING_DECLINED); } catch { /* Storage may be unavailable in Spotify's browser shell. */ }
}

export function markCommunityOnboardingDone(): void {
  try { localStorage.setItem(COMMUNITY_ONBOARDING_STORAGE_KEY, COMMUNITY_ONBOARDING_COMPLETED); } catch { /* Storage may be unavailable in Spotify's browser shell. */ }
}

export function CommunityOnboardingModal({
  onClose,
  launchContext = "first-run",
}: {
  onClose: () => void;
  launchContext?: "first-run" | "manual";
}) {
  const [configuration, setConfiguration] = useState(() => getDesktopSyncConfiguration());
  const [pending, setPending] = useState(() => syncPairingService.getPending());
  const [approvedPairing, setApprovedPairing] = useState<ApprovedPairing | null>(null);
  const [status, setStatus] = useState(() => activeSyncRuntime().getStatus());
  const [mergePreview, setMergePreview] = useState(() => activeSyncRuntime().getInitialMergePreview());
  const showingMergeReview = Boolean(mergePreview && (status === "merge-required" || status === "syncing" || status === "error"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [finished, setFinished] = useState(false);
  const [requiresReload, setRequiresReload] = useState(false);
  const [visibilityReviewed, setVisibilityReviewed] = useState<boolean | null>(null);
  const polling = useRef(false);

  const close = () => {
    if (pending || approvedPairing) syncPairingService.cancelPending();
    if (launchContext === "first-run") snoozeCommunityOnboarding();
    onClose();
  };

  const decline = () => {
    declineCommunityOnboarding();
    onClose();
  };

  useEffect(() => {
    const handleStatus = (event: Event) => {
      const runtime = activeSyncRuntime();
      const detail = (event as CustomEvent<{ status?: ReturnType<typeof syncRuntime.getStatus> }>).detail;
      setStatus(detail?.status || runtime.getStatus());
      setMergePreview(runtime.getInitialMergePreview());
    };
    window.addEventListener("tagify:syncStatus", handleStatus);
    handleStatus(new CustomEvent("tagify:syncStatus", { detail: { status: activeSyncRuntime().getStatus() } }));
    return () => window.removeEventListener("tagify:syncStatus", handleStatus);
  }, []);

  useEffect(() => {
    const htmlOverflow = document.documentElement.style.overflow;
    const bodyOverflow = document.body.style.overflow;

    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = htmlOverflow;
      document.body.style.overflow = bodyOverflow;
    };
  }, []);

  useEffect(() => {
    if (!configuration?.accessToken || configuration.profile?.handle) return;
    void hydrateSyncProfile(configuration).then((next) => {
      if (next) setConfiguration(next);
    });
  }, [configuration]);

  const begin = async () => {
    setBusy(true);
    setError("");
    try {
      const next = await syncPairingService.begin(COMMUNITY_ORIGIN, deviceName(), navigator.platform || "Spotify desktop");
      setApprovedPairing(null);
      setPending(next);
      openCommunityUrl(next.verificationUri);
    } catch (nextError) {
      setError(communityErrorMessage(nextError, "Couldn't start connecting to Community. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const poll = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    let completingApproval = false;
    setBusy(true);
    setError("");
    try {
      const result = await syncPairingService.poll();
      if (result.status === "approved") {
        const profile = await fetchCommunityProfile(result.approval.configuration.accessToken);
        const approval = profile
          ? {
              ...result.approval,
              configuration: { ...result.approval.configuration, profile },
            }
          : result.approval;
        completingApproval = true;
        setApprovedPairing(approval);
        setPending(null);
        const connection = await syncPairingService.complete(approval, {
          confirmedAccountSwitch: approval.relationship === "account-switch",
        });
        setConfiguration(connection.configuration);
        setApprovedPairing(null);
        setRequiresReload(connection.requiresReload);
        if (!connection.requiresReload) await activeSyncRuntime().activateCurrentAccount();
      } else {
        setPending(syncPairingService.getPending());
      }
    } catch (nextError) {
      setError(communityErrorMessage(nextError, "Couldn't finish connecting to Community. Please try again."));
      if (!completingApproval) setPending(syncPairingService.getPending());
    } finally {
      polling.current = false;
      setBusy(false);
    }
  }, []);

  const cancelPairing = () => {
    syncPairingService.cancelPending();
    setPending(null);
    setApprovedPairing(null);
    setError("");
  };

  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => void poll(), pending.interval * 1000);
    return () => window.clearInterval(timer);
  }, [pending, poll]);

  const profileHref = configuration?.profile?.handle ? `${COMMUNITY_ORIGIN}/@${configuration.profile.handle}` : COMMUNITY_ORIGIN;

  return <Portal><div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="community-onboarding-title">
    <section className={`${styles.modal} ${styles.onboardingModal}`}>
      <header>
        <div><p>Tagify 3.0</p><h2 id="community-onboarding-title"><Cloud size={20} /> Community setup</h2></div>
        <button type="button" aria-label="Close Community setup" onClick={close}><X /></button>
      </header>
      <div className={styles.body}>
        {!configuration && !pending && !approvedPairing ? <>
          <div className={styles.onboardingIntro}>
            <h3>Connect Tagify to Community</h3>
            <p>Back up your library and choose which tags appear on your public profile.</p>
          </div>
          <div className={styles.actions}>
            {launchContext === "first-run" ? (
              <button type="button" onClick={close} className={styles.secondary}>Not now</button>
            ) : (
              <button type="button" onClick={close} className={styles.secondary}>Cancel</button>
            )}
            <button type="button" onClick={() => void begin()} disabled={busy} className={styles.primary}><Link2 size={16} /> {busy ? "Connecting…" : "Connect"}</button>
          </div>
          {launchContext === "first-run" ? (
            <button type="button" onClick={decline} className={styles.quietAction}>Don't ask again</button>
          ) : null}
        </> : null}

        {!configuration && pending ? <>
          <div className={styles.code}><span>Approve this code on Community</span><strong>{pending.userCode}</strong></div>
          <p>We opened the account and approval page in your browser. Create or sign into your Community account there, approve this code, then return to Tagify.</p>
          <div className={styles.actions}>
            <button type="button" onClick={() => openCommunityUrl(pending.verificationUri)}><ExternalLink size={15} /> Open approval page</button>
            <button type="button" onClick={() => void poll()} disabled={busy}><RefreshCw size={15} /> {busy ? "Checking..." : "I've approved it"}</button>
            <button type="button" onClick={cancelPairing} className={styles.secondary}>Cancel linking</button>
          </div>
        </> : null}

        {!configuration && approvedPairing ? <>
          <div className={styles.connected} role="status">
            <UserCircle2 />
            <div>
              <strong>{busy ? `Connecting as ${profileLabel(approvedPairing.configuration)}…` : `Ready to connect as ${profileLabel(approvedPairing.configuration)}`}</strong>
              <span>{busy ? "Finishing your Community connection." : "Your browser approval is saved. Try connecting again."}</span>
            </div>
          </div>
          {!busy ? <div className={styles.actions}>
            <button type="button" onClick={cancelPairing} className={styles.secondary}>Cancel</button>
            <button type="button" onClick={() => void poll()} className={styles.primary}><RefreshCw size={16} /> Try again</button>
          </div> : null}
        </> : null}

        {configuration && !finished ? <>
          <div className={styles.connected}><CheckCircle2 /><div><strong>Connected as {profileLabel(configuration)}</strong><span>{communitySyncStatusLabel(status, visibilityReviewed)}</span></div></div>
          {!showingMergeReview ? <p>Tagify is syncing this library now. Before Community publishes your profile, review the tag categories, subfolders, and tags that can appear publicly.</p> : null}
          {requiresReload ? <div className={styles.warning}><ShieldCheck /><span>Reload Spotify to finish switching accounts before continuing setup.</span></div> : null}
          {status === "snapshot-required" ? <div className={styles.warning}><ShieldAlert /><span>Your library is still on this device. Try Sync now again. If it keeps stopping, save a Tagify backup and contact support.</span></div> : null}
          {showingMergeReview && mergePreview ? <InitialLibraryMergeReview review={mergePreview} onCommit={(resolutions) => activeSyncRuntime().commitInitialMerge(resolutions)} onDownloadBackup={() => activeSyncRuntime().downloadInitialMergeBackup()} /> : null}
          {!showingMergeReview ? <CommunityVisibilityReview connected={Boolean(configuration)} onReviewStateChange={setVisibilityReviewed} onSaved={(policy) => {
            if (policy.reviewedAt) {
              markCommunityOnboardingDone();
              setFinished(true);
            }
          }} /> : null}
          {!showingMergeReview ? <div className={styles.actions}>
            <button type="button" onClick={() => void activeSyncRuntime().syncNow()} disabled={busy || requiresReload || status === "idle" || status === "syncing" || status === "publishing" || visibilityReviewed === false}><RefreshCw size={15} /> {status === "syncing" ? "Syncing…" : visibilityReviewed === false ? "Save visibility first" : "Sync now"}</button>
          </div> : null}
        </> : null}

        {configuration && finished ? <>
          <div className={styles.onboardingHero}>
            <CheckCircle2 size={34} />
            <div>
              <h3>Your Community setup is ready.</h3>
              <p>Future syncs run automatically with your saved public visibility rules. You can reopen Sync any time to review or change what appears publicly.</p>
            </div>
          </div>
          <div className={styles.actions}>
            <button type="button" onClick={() => openCommunityUrl(profileHref)}><ExternalLink size={15} /> Open my profile</button>
            <button type="button" className={styles.primary} onClick={close}>Done</button>
          </div>
        </> : null}

        {error ? <div className={styles.error} role="alert">{error}</div> : null}
      </div>
    </section>
  </div></Portal>;
}

function deviceName() { return `Tagify on ${navigator.userAgent.includes("Mac") ? "Mac" : navigator.userAgent.includes("Windows") ? "Windows" : "desktop"}`; }
function activeSyncRuntime() { return window.TagifySync || syncRuntime; }
function profileLabel(configuration: DesktopSyncConfiguration) { return configuration.profile?.displayName || (configuration.profile?.handle ? `@${configuration.profile.handle}` : `Community account …${configuration.accountId.slice(-6)}`); }
async function hydrateSyncProfile(configuration: DesktopSyncConfiguration): Promise<DesktopSyncConfiguration | null> {
  const profile = await fetchCommunityProfile(configuration.accessToken);
  if (!profile?.handle) return null;
  const next = { ...configuration, profile };
  setDesktopSyncConfiguration(next);
  return next;
}

import React, { useMemo, useState } from "react";
import { ExternalLink, GitMerge, Globe, Link2, RefreshCw, ShieldAlert, Unplug, UserCircle2, Users } from "lucide-react";
import type { SyncStatus } from "@/services/sync/SyncRuntime";
import type { TagTaxonomy, TrackData } from "@/types/tagData";
import {
  COMMUNITY_ORIGIN,
  getCommunityDisconnectUrl,
  openCommunityUrl,
} from "./communityLinks";
import { changePublication, plural, publicTagSummary, SHARING_STATE_LABELS } from "./communityPublication";
import { communityProfileUrl } from "./CommunityShareDialog";
import styles from "./CommunityWorkspace.module.css";
import { backupLabel, communityErrorMessage } from "./communitySyncCopy";
import type { CommunitySharing } from "./useCommunitySharing";

interface Action {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

export function CommunityWorkspace({
  onConnectCommunity,
  onOpenCloudSync,
  onOpenSharing,
  connected,
  connectionPending = false,
  status,
  sharing,
  tracks,
  taxonomy,
  connectedAccountId,
  connectedDeviceId,
  onDisconnect,
}: {
  onConnectCommunity: () => void;
  onOpenCloudSync: () => void;
  onOpenSharing: () => void;
  connected: boolean;
  /** An approval code is waiting in the browser. */
  connectionPending?: boolean;
  status: SyncStatus;
  sharing: CommunitySharing;
  tracks: Record<string, TrackData>;
  taxonomy: TagTaxonomy;
  connectedAccountId: string | null;
  connectedDeviceId: string | null;
  onDisconnect: () => Promise<void>;
}) {
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState("");
  const [resuming, setResuming] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const reconnectRequired = connected && status === "reauthorize";
  const { policy, state } = sharing;
  const summary = useMemo(() => publicTagSummary(tracks, taxonomy, policy ?? undefined), [tracks, taxonomy, policy]);
  const amounts = `${plural(summary.tags, "tag")} on ${plural(summary.songs, "song")}`;

  const disconnect = async () => {
    if (connectedAccountId && connectedDeviceId) {
      openCommunityUrl(
        getCommunityDisconnectUrl(connectedAccountId, connectedDeviceId),
      );
    }
    setDisconnecting(true);
    setDisconnectError("");
    try {
      await onDisconnect();
      setConfirmingDisconnect(false);
    } catch (error) {
      setDisconnectError(communityErrorMessage(error, "Couldn't disconnect safely. Your library is still on this device. Please try again."));
    } finally {
      setDisconnecting(false);
    }
  };

  const resume = async () => {
    if (!policy) return;
    setResuming(true);
    setMessage(null);
    try {
      await changePublication(policy, "resume");
      setMessage({ tone: "success", text: "Updates resumed. Your profile catches up within a minute." });
    } catch (error) {
      setMessage({ tone: "error", text: communityErrorMessage(error, "Couldn't resume updates. Please try again.") });
    } finally {
      setResuming(false);
    }
  };

  const visit: Action = { label: "Visit Community", icon: <ExternalLink size={16} />, onClick: () => openCommunityUrl(COMMUNITY_ORIGIN) };
  let lead: React.ReactNode;
  let primary: Action;
  let secondary: Action | null = visit;
  if (!connected) {
    lead = connectionPending ? "Finish connecting in your browser, then come back here."
      : summary.songs > 0 ? `${amounts} are ready to share.`
      : "Tag a few songs, then share them on your Community profile.";
    primary = { label: connectionPending ? "Finish connecting" : "Share my tags", icon: connectionPending ? <Link2 size={16} /> : <Globe size={16} />, onClick: onConnectCommunity };
  } else if (reconnectRequired) {
    lead = "Reconnect this computer to keep backing up and sharing your tags.";
    primary = { label: "Reconnect device", icon: <ShieldAlert size={16} />, onClick: onOpenCloudSync };
  } else if (status === "merge-required") {
    lead = "Choose how to combine this computer's library with Community before sharing.";
    primary = { label: "Combine libraries", icon: <GitMerge size={16} />, onClick: onOpenCloudSync };
  } else if (state === "review" || state === "private") {
    lead = state === "review"
      ? `Your tags aren't public yet.${summary.songs > 0 ? ` ${amounts} would appear.` : ""}`
      : `You're keeping your tags private.${summary.songs > 0 ? ` ${amounts} would appear if you publish.` : ""}`;
    primary = { label: "Publish my tags", icon: <Globe size={16} />, onClick: onOpenSharing };
  } else if (state === "paused") {
    lead = <>Your profile shows your tags from before you paused. New changes stay private until you resume. <ChooseLink onClick={onOpenSharing} /></>;
    primary = { label: resuming ? "Resuming…" : "Resume updates", icon: <RefreshCw size={16} />, onClick: () => void resume(), disabled: resuming };
  } else if (state === "public") {
    lead = <>Your tags are on your profile. <ChooseLink onClick={onOpenSharing} /></>;
    primary = visit;
    secondary = { label: "View my profile", icon: <UserCircle2 size={16} />, onClick: () => openCommunityUrl(communityProfileUrl(sharing.handle)) };
  } else if (sharing.phase === "error") {
    lead = <>Couldn't check what's public. <button type="button" className={styles.inlineLink} onClick={sharing.refresh}>Try again</button></>;
    primary = { label: "Share my tags", icon: <Globe size={16} />, onClick: onOpenSharing };
  } else {
    lead = "Checking what's public…";
    primary = { label: "Share my tags", icon: <Globe size={16} />, onClick: onOpenSharing };
  }

  return (
    <section className={styles.workspace} aria-labelledby="community-title">
      <div className={styles.card}>
        <div className={styles.icon} aria-hidden="true">
          <Users size={32} />
        </div>

        <div className={styles.copy}>
          <p className={styles.eyebrow}>Tagify Community</p>
          <h2
            id="community-title"
            aria-label="Discover tags. Share your own."
          >
            <span>Discover tags.</span>
            <span>Share your own.</span>
          </h2>
          <p className={styles.lead}>{lead}</p>
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.primaryAction} onClick={primary.onClick} disabled={primary.disabled}>
            {primary.icon}
            {primary.label}
          </button>
          {secondary ? <button type="button" className={styles.secondaryAction} onClick={secondary.onClick}>
            {secondary.icon}
            {secondary.label}
          </button> : null}
        </div>

        {message ? <p className={message.tone === "success" ? styles.message : styles.disconnectError} role="status">{message.text}</p> : null}

        {connected ? (
          <div className={styles.connectionPanel}>
            {confirmingDisconnect ? (
              <div className={styles.disconnectConfirmation}>
                <div>
                  <strong>Stop cloud backup?</strong>
                  <span>
                    Your tags stay here. Cloud sync stops, and Community signs out in your browser.
                  </span>
                </div>
                <div className={styles.disconnectActions}>
                  <button
                    type="button"
                    onClick={() => setConfirmingDisconnect(false)}
                    disabled={disconnecting}
                  >
                    Keep connected
                  </button>
                  <button
                    type="button"
                    className={styles.disconnectConfirmButton}
                    onClick={() => void disconnect()}
                    disabled={disconnecting}
                  >
                    <Unplug size={14} />
                    {disconnecting ? "Disconnecting…" : "Disconnect now"}
                  </button>
                </div>
              </div>
            ) : (
              <div className={`${styles.connectionStatus} ${reconnectRequired ? styles.reconnectStatus : ""}`}>
                <span className={reconnectRequired ? styles.reconnectDot : styles.connectedDot} aria-hidden="true" />
                <span>{reconnectRequired ? "Device revoked · Reconnect required" : `${state ? `${SHARING_STATE_LABELS[state]} · ` : ""}${backupLabel(status)}`}</span>
                {!reconnectRequired ? <button type="button" onClick={onOpenCloudSync}>Sync</button> : null}
                <button
                  type="button"
                  onClick={() => setConfirmingDisconnect(true)}
                >
                  Disconnect
                </button>
              </div>
            )}
            {disconnectError ? (
              <p className={styles.disconnectError} role="alert">
                {disconnectError}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ChooseLink({ onClick }: { onClick: () => void }) {
  return <button type="button" className={styles.inlineLink} onClick={onClick}>Choose what's hidden</button>;
}
